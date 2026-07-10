"""
Motor RAG (Retrieval-Augmented Generation) del chatbot UNCP.

Flujo de cada consulta:
    1. Convertir la pregunta en un vector (embedding)
    2. Clasificar el intento de la pregunta → categoría(s) de documentos
    3. Buscar en ChromaDB filtrando por categoría (bi-encoder) — menos ruido
    4. Cross-Encoder reranker reordena los candidatos y selecciona TOP_K_RESULTS
    5. Armar un prompt con el contexto recuperado + la pregunta
    6. Enviar al LLM (Gemini o Ollama) y hacer streaming de la respuesta
    7. Al finalizar, enviar las fuentes usadas
"""
import json
import logging
import re
from typing import AsyncGenerator

import chromadb
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sentence_transformers import CrossEncoder, SentenceTransformer

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

COLLECTION_NAME = "uncp_docs"

# ─── Singletons — se cargan una sola vez al arrancar ─────────────────────────
_embedding_model: SentenceTransformer | None = None
_reranker_model: CrossEncoder | None = None


def get_embedding_model() -> SentenceTransformer:
    """Carga el modelo de embeddings una sola vez y lo reutiliza en todas las consultas."""
    global _embedding_model
    if _embedding_model is None:
        logger.info(f"Cargando modelo de embeddings: {settings.EMBEDDING_MODEL}")
        _embedding_model = SentenceTransformer(settings.EMBEDDING_MODEL)
        logger.info("Modelo de embeddings listo.")
    return _embedding_model


def get_reranker() -> CrossEncoder:
    """
    Carga el Cross-Encoder una sola vez.
    BAAI/bge-reranker-v2-m3: 280 MB, multilingüe (incluye español),
    se descarga en hf_cache igual que el modelo de embeddings.
    """
    global _reranker_model
    if _reranker_model is None:
        logger.info(f"Cargando reranker: {settings.RERANKER_MODEL}")
        _reranker_model = CrossEncoder(settings.RERANKER_MODEL)
        logger.info("Reranker listo.")
    return _reranker_model


def _get_collection() -> chromadb.Collection:
    client = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    return client.get_or_create_collection(
        COLLECTION_NAME, metadata={"hnsw:space": "cosine"}
    )


def _get_llm():
    """Instancia el LLM según LLM_PROVIDER en .env — Gemini o Ollama."""
    if settings.LLM_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
        )
    from langchain_ollama import ChatOllama
    return ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_BASE_URL,
        num_ctx=settings.OLLAMA_NUM_CTX,
        # Mantiene el modelo cargado en memoria entre consultas
        # (el default de 5 min lo descarga y la siguiente pregunta tarda ~10s extra)
        keep_alive="30m",
    )


# ─── Expansión de query ───────────────────────────────────────────────────────

# Términos estáticos: vocabulario estudiantil → vocabulario oficial UNCP
# Solo para palabras que NO tienen patrón predecible.
# Los patrones de año (2026-1 → 2026-I) se manejan con regex abajo.
_VOCAB_MAP = {
    "semestre":         "semestre periodo lectivo",
    "inicio de clases": "inicio del periodo lectivo",
    "cuando empiezan":  "inicio del periodo lectivo",
    "cuando empieza":   "inicio del periodo lectivo",
    "carnet":           "carné universitario",
    "matricula":        "matrícula proceso de matrícula",
    "matrícula":        "matrícula proceso de matrícula",
    "beca":             "beca beneficio económico",
    "pension":          "pensión pago arancel",
    "pensión":          "pensión pago arancel",
    "grado":            "grado académico título profesional",
    "titulo":           "título profesional grado académico",
    "título":           "título profesional grado académico",
}


# ─── Clasificación de intento ────────────────────────────────────────────────
# Cada clave coincide con una categoría de CATEGORY_MAP en ingest.py.
# Agregar aquí nuevos patrones cuando se indexen documentos de nuevas categorías.
_INTENT_PATTERNS: dict[str, list[str]] = {
    "calendario": [
        r"\bcuándo\b", r"\bfecha[s]?\b", r"\binicio\b", r"\bfin\b",
        r"\bsemestre\b", r"\bperiodo\b", r"\bvacacion", r"\bcalendario\b",
        r"\bcronograma\b", r"\bplazo[s]?\b",
    ],
    "tarifario": [
        r"\bcosto[s]?\b", r"\bprecio[s]?\b", r"\bcuánto\b.*\bcuesta\b",
        r"\bpago[s]?\b", r"\barancel\b", r"\bS/\.", r"\btarifar",
        r"\bgratuito\b", r"\bgratis\b", r"\bbarato\b",
    ],
    "matricula": [
        r"\bmatrícul\b", r"\bmatricul\b", r"\binscripci\b",
        r"\badesa\b", r"\brequisito[s]?\b", r"\bdocumento[s]?\b",
        r"\bcrédit[o]?\b", r"\bcarga\b.*\bacadémica\b",
    ],
    "grados": [
        r"\bgrado\b", r"\btítulo\b", r"\btitulo\b", r"\bsustentaci\b",
        r"\begresad\b", r"\bbach", r"\blic\b", r"\bsigt\b",
        r"\btitulaci\b", r"\bexpediente\b",
    ],
    "reglamento": [
        r"\breglamento\b", r"\bnorma[s]?\b", r"\bresponsabilidad\b",
        r"\bsanción\b", r"\bsancion\b", r"\bdisciplina\b", r"\bprohibi",
    ],
}


def classify_intent(question: str) -> list[str]:
    """
    Detecta las categorías relevantes para una pregunta.

    Cuenta cuántos patrones de cada categoría coinciden con la pregunta y
    devuelve todas las categorías con al menos un match, ordenadas de mayor
    a menor score.

    Retorna lista vacía si ninguna categoría coincide → búsqueda global.

    Ejemplos:
        "¿cuándo inicia el semestre?"          → ["calendario"]
        "¿cuánto cuesta matricularse?"         → ["tarifario", "matricula"]
        "explícame el reglamento estudiantil"  → ["reglamento"]
        "hola, ¿cómo estás?"                   → []  (búsqueda global)
    """
    q = question.lower()
    scores: dict[str, int] = {}

    for category, patterns in _INTENT_PATTERNS.items():
        score = sum(1 for p in patterns if re.search(p, q, re.IGNORECASE))
        if score > 0:
            scores[category] = score

    if not scores:
        return []

    return sorted(scores, key=scores.__getitem__, reverse=True)


def _expand_query(question: str) -> str:
    """
    Enriquece la query antes de generar el embedding sin introducir ruido.

    Reglas:
      1. YYYY-1 → añade YYYY-I  (solo el equivalente romano, nada más)
         YYYY-2 → añade YYYY-II
      2. Vocab map: añade sinónimos institucionales para términos estáticos

    Principio: cada adición debe ser precisa. Agregar términos genéricos como
    "2026" o "periodo" sin el número de semestre confunde el vector y baja la calidad.
    """
    extra: list[str] = []

    # Regla 1 — conversión arábigo → romano para cualquier año
    # "2026-2" → añade "2026-II"  |  "2030-1" → añade "2030-I"
    for match in re.finditer(r'\b(\d{4})-([12])\b', question):
        year, num = match.group(1), match.group(2)
        roman = "I" if num == "1" else "II"
        roman_form = f"{year}-{roman}"
        if roman_form.lower() not in question.lower():
            extra.append(roman_form)

    # Regla 2 — vocab map de términos estáticos conocidos
    q_lower = question.lower()
    for student_term, official_terms in _VOCAB_MAP.items():
        if student_term in q_lower and official_terms not in q_lower:
            extra.append(official_terms)

    if extra:
        expanded = f"{question} {' '.join(extra)}"
        logger.info(f"Query expandida: '{expanded[:120]}'")
        return expanded

    return question


# ─── Recuperación de contexto ─────────────────────────────────────────────────

def rerank_chunks(question: str, chunks: list[dict], top_k: int) -> list[dict]:
    """
    Reordena los chunks candidatos usando un Cross-Encoder.

    El bi-encoder (ChromaDB) codifica pregunta y chunk por separado → rápido pero impreciso.
    El cross-encoder los evalúa juntos en un solo forward pass → lento pero preciso.
    Se aplica solo sobre los candidatos (20), no sobre toda la colección.

    Agrega el campo 'rerank_score' a cada chunk y devuelve los top_k mejor puntuados.
    Si RERANKER_ENABLED=false, devuelve los primeros top_k sin cambios.
    """
    if not settings.RERANKER_ENABLED or not chunks:
        return chunks[:top_k]

    reranker = get_reranker()
    pairs = [(question, c["document"]) for c in chunks]
    scores = reranker.predict(pairs)  # array de floats (logits del cross-encoder)

    for chunk, raw_score in zip(chunks, scores):
        chunk["rerank_score"] = round(float(raw_score), 4)

    reranked = sorted(chunks, key=lambda x: x["rerank_score"], reverse=True)

    logger.info(
        f"Reranking: {len(chunks)} candidatos → top {top_k} "
        f"(rerank_scores: {[round(c['rerank_score'], 2) for c in reranked[:top_k]]})"
    )
    return reranked[:top_k]


def retrieve_chunks(
    question: str,
    category_filter: list[str] | None = None,
) -> list[dict]:
    """
    Pipeline de recuperación en dos etapas con filtrado semántico opcional.

    Etapa 1 — Bi-encoder + filtro de categoría (ChromaDB):
        Si se pasa category_filter, la búsqueda se limita a los chunks de esas
        categorías. Menos candidatos → menos ruido → mejor calidad final.
        Si el filtro devuelve 0 resultados (documento no indexado aún), se hace
        automáticamente una búsqueda global como fallback.

    Etapa 2 — Cross-Encoder reranker:
        Reordena los candidatos y devuelve los TOP_K_RESULTS más relevantes.
    """
    model      = get_embedding_model()
    collection = _get_collection()

    total = collection.count()
    if total == 0:
        return []

    n_candidates = (
        min(settings.RERANKER_CANDIDATES, total)
        if settings.RERANKER_ENABLED
        else min(settings.TOP_K_RESULTS, total)
    )

    expanded  = _expand_query(question)
    embedding = model.encode(expanded).tolist()

    query_params: dict = {
        "query_embeddings": [embedding],
        "n_results":        n_candidates,
        "include":          ["documents", "metadatas", "distances"],
    }

    if category_filter:
        query_params["where"] = (
            {"category": {"$eq": category_filter[0]}}
            if len(category_filter) == 1
            else {"category": {"$in": category_filter}}
        )
        logger.info(f"Filtro de categoría activo: {category_filter}")

    try:
        results = collection.query(**query_params)
    except Exception:
        # ChromaDB puede lanzar error si ningún doc tiene el campo 'category'
        # (chunks indexados antes de esta mejora). Fallback a búsqueda global.
        logger.warning("Error en filtro de categoría — búsqueda global como fallback")
        query_params.pop("where", None)
        results = collection.query(**query_params)

    chunks = []
    for doc, meta, distance in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        chunks.append({
            "document": doc,
            "metadata": meta,
            "score":    round(1 - distance, 3),
        })

    # Fallback: si el filtro no encontró nada, re-intentar sin filtro
    if not chunks and category_filter:
        logger.info(
            f"Filtro {category_filter} → 0 resultados. "
            "Re-intentando búsqueda global."
        )
        return retrieve_chunks(question, category_filter=None)

    logger.info(
        f"Bi-encoder: '{question[:60]}' → {len(chunks)} candidatos "
        f"(coseno más alto: {chunks[0]['score'] if chunks else 0})"
    )

    return rerank_chunks(question, chunks, settings.TOP_K_RESULTS)


# ─── Prompt del sistema ───────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
Eres el asistente virtual oficial de la UNCP (Universidad Nacional del Centro del Perú), \
ubicada en Huancayo, Perú.

Tu misión es orientar a los estudiantes sobre trámites administrativos, requisitos, \
plazos, costos y procedimientos universitarios.

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con información del contexto proporcionado a continuación.
2. Si la información NO está en el contexto, responde exactamente:
   "No tengo información sobre eso en los documentos disponibles de la UNCP. \
Te recomiendo consultar directamente con la oficina correspondiente."
3. NO inventes datos, fechas, montos ni requisitos que no estén en el contexto.
4. Usa un tono formal y claro, apropiado para comunicación universitaria en español.
5. Sé conciso: responde lo que pregunta el estudiante sin información innecesaria.
6. Al finalizar tu respuesta, añade la fuente entre corchetes:
   [Fuente: nombre_del_archivo | pág. X]
7. Responde SIEMPRE a la última pregunta por sí misma. Si los mensajes anteriores \
de la conversación no tienen relación con la pregunta actual, ignóralos por completo.

CONTEXTO DE DOCUMENTOS UNCP:
{context}
"""

# Respuesta fija cuando la pregunta no trata de los documentos indexados
# (saludos, ruido, temas ajenos). Evita llamar al LLM con contexto irrelevante.
OFF_TOPIC_MSG = (
    "Soy el asistente virtual de trámites de la UNCP 🎓. Puedo ayudarte con "
    "**matrícula**, **calendario académico**, **costos y tarifas**, **grados y títulos** "
    "y **reglamentos**. ¿Sobre qué trámite necesitas información?"
)

# Prefijos de respuestas sin información útil. Los intercambios que terminaron
# así se excluyen del historial que ve el LLM: no aportan contexto y anclan
# al modelo a repetir que no sabe.
_FALLBACK_PREFIXES = (
    "No tengo información sobre eso",
    "Soy el asistente virtual de trámites de la UNCP",
    "No hay documentos indexados aún",
)


def _clean_history(history: list[dict] | None) -> list[dict] | None:
    """
    Filtra del historial los intercambios donde el asistente respondió con un
    fallback (junto con la pregunta del usuario que lo provocó — normalmente
    ruido o tema ajeno). Así una racha de mensajes sin sentido no contamina
    la reformulación ni el contexto conversacional de la siguiente pregunta real.
    """
    if not history:
        return history

    cleaned: list[dict] = []
    for msg in history:
        is_fallback = msg.get("role") == "assistant" and any(
            msg.get("content", "").startswith(p) for p in _FALLBACK_PREFIXES
        )
        if is_fallback:
            if cleaned and cleaned[-1].get("role") == "user":
                cleaned.pop()
            continue
        cleaned.append(msg)
    return cleaned


def _build_context(chunks: list[dict]) -> str:
    """
    Construye el bloque de contexto para el prompt del LLM.

    Con Parent-Child chunking:
      - El retrieval encontró HIJOS (vectores precisos)
      - El LLM recibe el PADRE completo (contexto rico)
      - Si varios hijos apuntan al mismo padre, el padre se incluye solo una vez
        (evita repetir el mismo texto al LLM)

    Sin Parent-Child (chunks legacy sin parent_text):
      - Usa el texto del chunk directamente, sin deduplicación
    """
    seen_parents: set[str] = set()
    parts = []

    for c in chunks:
        parent_text = c["metadata"].get("parent_text")

        if parent_text:
            # Deduplicar por parent_id — varios hijos pueden apuntar al mismo padre
            dedup_key = c["metadata"].get("parent_id", parent_text[:50])
            if dedup_key in seen_parents:
                continue
            seen_parents.add(dedup_key)
            text = parent_text
        else:
            text = c["document"]  # chunk legacy sin parent-child

        parts.append(
            f"[{c['metadata']['source']} | pág. {c['metadata']['page']}]\n{text}"
        )

    return "\n\n---\n\n".join(parts)


def _build_messages(question: str, chunks: list[dict]) -> list:
    """Arma los mensajes para el LLM: system prompt con contexto + pregunta del usuario."""
    return [
        SystemMessage(content=SYSTEM_PROMPT.format(context=_build_context(chunks))),
        HumanMessage(content=question),
    ]


def _build_messages_with_history(
    question: str,
    chunks: list[dict],
    history: list[dict] | None,
) -> list:
    """
    Arma los mensajes con sliding window del historial de conversación.
    El LLM recibe: system prompt → N intercambios anteriores → pregunta actual.
    """
    messages: list = [
        SystemMessage(content=SYSTEM_PROMPT.format(context=_build_context(chunks)))
    ]

    if history:
        window = history[-settings.HISTORY_WINDOW:]
        for msg in window:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))

    messages.append(HumanMessage(content=question))
    return messages


# Señales de que una pregunta depende del contexto anterior
_CONTEXT_SIGNALS = re.compile(
    r'^¿?\s*(y\s|también|además|pero|entonces|o\s+sea)|'
    r'\b(eso|ese|esa|esto|esta|ello|lo\s+mismo|igual|aquél|aquella)\b',
    re.IGNORECASE,
)


async def _reformulate_with_history(question: str, history: list[dict]) -> str:
    """
    Reescribe una pregunta dependiente del contexto en una pregunta autónoma.
    Solo hace la llamada al LLM si detecta señales de dependencia contextual.

    Ejemplo:
        "¿Y cuánto cuesta?" + historial sobre matrícula
        → "¿Cuánto cuesta el proceso de matrícula regular?"
    """
    if not history or len(history) < 2:
        return question

    # Solo reformular ante señales EXPLÍCITAS de dependencia (pronombres/conectores).
    # La longitud NO es criterio: casi toda pregunta real es corta, y reformular una
    # pregunta ya autónoma la contamina con el tema del intercambio anterior
    # (si ese intercambio fue ruido, la query resultante es basura).
    if not _CONTEXT_SIGNALS.search(question):
        return question

    # Solo usar el último intercambio (user + assistant) para reformular
    last_exchange = history[-2:]
    history_text = "\n".join(
        f"{m['role'].upper()}: {m['content'][:300]}" for m in last_exchange
    )

    prompt = (
        f"Historial reciente:\n{history_text}\n\n"
        f'Nueva pregunta: "{question}"\n\n'
        "Si la pregunta depende del historial, reescríbela como pregunta autónoma y completa. "
        "Si ya es autónoma, devuélvela sin cambios. "
        "Responde SOLO con la pregunta reescrita, sin explicación."
    )

    llm = _get_llm()
    try:
        result = await llm.ainvoke(prompt)
        reformulated = _extract_text(result.content).strip().strip('"').strip()
        if _is_valid_reformulation(question, history_text, reformulated):
            logger.info(f"Query reformulada: '{question}' → '{reformulated[:80]}'")
            return reformulated
        logger.info(f"Reformulación descartada por inválida: '{reformulated[:80]}'")
    except Exception as e:
        logger.warning(f"Reformulación falló, usando query original: {e}")

    return question


def _is_valid_reformulation(question: str, history_text: str, reformulated: str) -> bool:
    """
    Acepta la reformulación solo si parece una pregunta real y reutiliza
    vocabulario de la conversación. Si el LLM inventó un tema nuevo o devolvió
    una explicación en vez de una pregunta, es más seguro usar la query original.
    """
    if not reformulated or len(reformulated) < 6:
        return False
    # Una pregunta autónoma cabe en una línea; saltos de línea o textos muy
    # largos indican que el LLM respondió con explicación o listado
    if "\n" in reformulated or len(reformulated) > 300:
        return False
    # Debe compartir al menos un término de contenido con la pregunta o el
    # historial que la originó
    source_words = set(re.findall(r"\w{4,}", f"{question} {history_text}".lower()))
    new_words = set(re.findall(r"\w{4,}", reformulated.lower()))
    return bool(source_words & new_words)


# ─── Stream RAG ───────────────────────────────────────────────────────────────

async def stream_rag_response(
    question: str,
    history: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Pipeline RAG completo con streaming Server-Sent Events (SSE).

    Args:
        question: Pregunta actual del estudiante.
        history:  Últimos N mensajes [{"role": "user"|"assistant", "content": "..."}].
                  Si se pasa historial, la query se reformula para retrieval y el LLM
                  recibe el contexto conversacional completo.

    Formato de cada evento SSE:
        data: {"type": "delta",   "content": "token de texto"}
        data: {"type": "sources", "sources": [...]}
        data: {"type": "done"}
    """

    # 0. Excluir del historial los intercambios que terminaron en fallback
    #    (ruido, small-talk, "no tengo información") — no aportan contexto
    history = _clean_history(history)

    # 1. Reformular la query si hay historial (mejora el retrieval semántico)
    effective_query = (
        await _reformulate_with_history(question, history)
        if history
        else question
    )

    # 2. Clasificar el intento → categoría(s) de documentos a filtrar
    categories = classify_intent(effective_query)

    # 3. Recuperar fragmentos filtrando por categoría (o globalmente si no hay match)
    chunks = retrieve_chunks(effective_query, category_filter=categories or None)

    if not chunks:
        yield _sse({"type": "delta", "content": (
            "No hay documentos indexados aún. "
            "Ejecuta el script de ingestion para cargar los documentos de la UNCP: "
            "`docker compose exec backend python ingest.py`"
        )})
        yield _sse({"type": "done"})
        return

    # 3b. Umbral de relevancia: si ni el mejor chunk supera el mínimo, la
    #     pregunta no trata de los documentos indexados (saludo, ruido, tema
    #     ajeno). Responder mensaje fijo sin arriesgar una alucinación del LLM.
    best_score = max(
        (c["rerank_score"] for c in chunks if "rerank_score" in c),
        default=None,
    )
    if best_score is not None and best_score < settings.RERANKER_MIN_SCORE:
        logger.info(
            f"Query fuera de dominio (mejor rerank_score {best_score} < "
            f"{settings.RERANKER_MIN_SCORE}): '{question[:60]}'"
        )
        yield _sse({"type": "delta", "content": OFF_TOPIC_MSG})
        yield _sse({"type": "done"})
        return

    # 4. Construir prompt: contexto recuperado + historial + pregunta actual
    messages = _build_messages_with_history(question, chunks, history)

    # 4. Llamar al LLM y hacer streaming token a token
    llm = _get_llm()
    try:
        async for chunk in llm.astream(messages):
            token = _extract_text(chunk.content)
            if token:
                yield _sse({"type": "delta", "content": token})
    except Exception as e:
        logger.error(f"Error en LLM stream: {e}")
        yield _sse({"type": "delta", "content": f"\n\n[Error al generar respuesta: {e}]"})

    # 5. Enviar las fuentes utilizadas al finalizar
    # Muestra rerank_score si está disponible (más preciso que la similitud coseno)
    sources = [
        {
            "file": c["metadata"]["source"],
            "page": c["metadata"]["page"],
            "score": c.get("rerank_score", c["score"]),
        }
        for c in chunks
    ]
    yield _sse({"type": "sources", "sources": sources})
    yield _sse({"type": "done"})


def _extract_text(content) -> str:
    """
    Normaliza el content de un chunk LangChain a string plano.
    Gemini 3.x devuelve lista de bloques: [{"type": "text", "text": "..."}]
    Gemini 2.x / Ollama devuelven string directo.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content) if content else ""


def _sse(data: dict) -> str:
    """Formatea un dict como línea SSE válida."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
