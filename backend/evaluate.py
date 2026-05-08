"""
Evaluación sistemática del chatbot UNCP con RAGAs.

Mide 4 métricas de calidad RAG sobre un dataset de preguntas con respuestas esperadas:

  Faithfulness        — ¿Cada afirmación de la respuesta está en el contexto?
                        Detecta alucinaciones. Ideal: 1.0
  Answer Relevancy    — ¿La respuesta responde la pregunta que se hizo?
                        Detecta respuestas fuera de tema. Ideal: 1.0
  Context Recall      — ¿El contexto recuperado contiene todo lo necesario?
                        Mide si el retrieval encontró la información correcta. Ideal: 1.0
  Context Precision   — ¿Qué fracción del contexto recuperado es realmente útil?
                        Mide si hay "ruido" en el contexto. Ideal: 1.0

─────────────────────────────────────────────────────────────────────────────
DÓNDE AGREGAR PREGUNTAS:
    evaluation/test_dataset.json

    Formato de cada entrada:
    {
        "pregunta": "¿Cuándo inicia el semestre 2026-II?",
        "respuesta_esperada": "El semestre 2026-II inicia el 31 de agosto."
    }

    La respuesta_esperada debe copiarse DIRECTAMENTE del PDF oficial.
    Mínimo recomendado para la tesis: 30 preguntas.

─────────────────────────────────────────────────────────────────────────────
USO:
    docker compose exec backend python evaluate.py

RESULTADOS:
    evaluation/results/YYYYMMDD_HHMMSS.json   ← detalle por pregunta
    evaluation/results/YYYYMMDD_HHMMSS.csv    ← para abrir en Excel
    (impresos también en consola)

REQUISITOS:
    - ChromaDB con documentos indexados (python ingest.py)
    - GEMINI_API_KEY configurada en .env
    - ragas y datasets instalados (están en requirements.txt)
─────────────────────────────────────────────────────────────────────────────
"""
import csv
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

# ── Configuración ──────────────────────────────────────────────────────────────

# Número máximo de preguntas a evaluar (None = todas).
# Cambia a un número pequeño (ej: 5) para pruebas rápidas antes de la evaluación completa.
MAX_QUESTIONS: int | None = None

# Segundos de espera entre preguntas para no saturar la API de Gemini.
# Aumentar a 3-5 si recibes errores de rate limit.
DELAY_BETWEEN_QUESTIONS: float = 1.5

# ──────────────────────────────────────────────────────────────────────────────

sys.path.insert(0, str(Path(__file__).parent))

logging.basicConfig(level=logging.WARNING, format="%(message)s")
logger = logging.getLogger(__name__)

DATASET_PATH = Path(__file__).parent / "evaluation" / "test_dataset.json"
RESULTS_DIR  = Path(__file__).parent / "evaluation" / "results"


# ─── Verificar dependencias ───────────────────────────────────────────────────

def _check_deps() -> None:
    missing = []
    try:
        import ragas  # noqa: F401
    except ImportError:
        missing.append("ragas>=0.1.9,<0.2.0")
    try:
        import datasets  # noqa: F401
    except ImportError:
        missing.append("datasets>=2.14.0")
    if missing:
        print("─" * 60)
        print("ERROR: Faltan dependencias. Reconstruye la imagen Docker:")
        print("  docker compose build backend")
        print("  docker compose up -d")
        print(f"\nPaquetes faltantes: {', '.join(missing)}")
        print("─" * 60)
        sys.exit(1)


# ─── Dataset ──────────────────────────────────────────────────────────────────

def load_dataset() -> list[dict]:
    """
    Carga evaluation/test_dataset.json y filtra entradas válidas.
    Las entradas con claves que empiezan por '_' son comentarios y se ignoran.
    Las entradas sin 'respuesta_esperada' real (con "REEMPLAZAR") se omiten con aviso.
    """
    if not DATASET_PATH.exists():
        print(f"ERROR: No se encontró el dataset en:\n  {DATASET_PATH}")
        print("\nCrea el archivo con tus preguntas UNCP.")
        sys.exit(1)

    with open(DATASET_PATH, encoding="utf-8") as f:
        raw = json.load(f)

    entries = []
    skipped = 0

    for item in raw:
        # Ignorar entradas que son solo comentarios (claves empiezan con _)
        if all(k.startswith("_") for k in item):
            continue

        pregunta = item.get("pregunta", "").strip()
        respuesta = item.get("respuesta_esperada", "").strip()

        if not pregunta:
            skipped += 1
            continue

        if not respuesta or "REEMPLAZAR" in respuesta:
            print(f"  ⚠  Omitida (sin respuesta_esperada): '{pregunta[:60]}'")
            skipped += 1
            continue

        entries.append({
            "pregunta": pregunta,
            "respuesta_esperada": respuesta,
            "categoria": item.get("_categoria", "general"),
        })

    if not entries:
        print("\nERROR: No hay preguntas válidas en el dataset.")
        print(f"Edita: {DATASET_PATH}")
        print("Reemplaza los valores 'REEMPLAZAR' con respuestas reales de los PDFs.")
        sys.exit(1)

    if skipped:
        print(f"  → {skipped} entradas omitidas (sin respuesta_esperada completada)\n")

    return entries


# ─── Pipeline RAG ─────────────────────────────────────────────────────────────

def run_rag_for_question(question: str) -> dict:
    """
    Ejecuta el pipeline RAG completo para una pregunta de evaluación.
    Usa el mismo retrieve_chunks() + LLM que usa el chatbot real.
    Retorna: answer (str generada) + contexts (list[str] pasados al LLM)
    """
    from rag import (
        _build_messages_with_history,
        _extract_text,
        _get_llm,
        retrieve_chunks,
    )

    chunks = retrieve_chunks(question)

    if not chunks:
        return {
            "answer": "No hay documentos indexados en ChromaDB.",
            "contexts": [],
        }

    # Construir mensajes sin historial (cada pregunta es independiente en evaluación)
    messages = _build_messages_with_history(question, chunks, history=None)

    llm = _get_llm()
    try:
        response = llm.invoke(messages)
        answer = _extract_text(response.content).strip()
    except Exception as e:
        answer = f"[Error al generar respuesta: {e}]"

    # RAGAs recibe el mismo texto que el LLM (parent_text si existe)
    contexts = [
        c["metadata"].get("parent_text", c["document"])
        for c in chunks
    ]

    return {"answer": answer, "contexts": contexts}


def run_all_questions(entries: list[dict]) -> list[dict]:
    """Ejecuta el pipeline RAG para cada pregunta con barra de progreso."""
    total = len(entries)
    results = []

    print(f"\nEjecutando pipeline RAG para {total} preguntas...\n")

    for i, entry in enumerate(entries, 1):
        question = entry["pregunta"]
        prefix = f"  [{i:2d}/{total}]"

        print(f"{prefix} {question[:65]}{'...' if len(question) > 65 else ''}")

        start = time.time()
        rag_result = run_rag_for_question(question)
        elapsed = time.time() - start

        results.append({
            "question":     question,
            "ground_truth": entry["respuesta_esperada"],
            "answer":       rag_result["answer"],
            "contexts":     rag_result["contexts"],
            "categoria":    entry["categoria"],
            "latency_s":    round(elapsed, 2),
        })

        print(f"         ✓ {elapsed:.1f}s — {len(rag_result['contexts'])} chunks recuperados")

        if i < total:
            time.sleep(DELAY_BETWEEN_QUESTIONS)

    print(f"\n✓ Pipeline completado para {total} preguntas.\n")
    return results


# ─── Evaluación RAGAs ─────────────────────────────────────────────────────────

def configure_ragas_llm():
    """
    Configura el LLM y embeddings de Gemini para que RAGAs los use
    al calcular las métricas (Faithfulness, Answer Relevancy, etc.).
    """
    from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
    from ragas.llms import LangchainLLM

    from config import get_settings
    s = get_settings()

    if not s.GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY no configurada en .env")
        print("La evaluación RAGAs requiere Gemini para juzgar las respuestas.")
        sys.exit(1)

    llm = ChatGoogleGenerativeAI(
        model=s.GEMINI_MODEL,
        google_api_key=s.GEMINI_API_KEY,
    )
    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/embedding-001",
        google_api_key=s.GEMINI_API_KEY,
    )
    ragas_llm = LangchainLLM(llm)
    return ragas_llm, embeddings


def run_ragas_evaluation(results: list[dict]) -> dict:
    """
    Construye el Dataset de RAGAs y calcula las 4 métricas.
    Retorna el dict con los scores: faithfulness, answer_relevancy,
    context_recall, context_precision.
    """
    from datasets import Dataset
    from ragas import evaluate
    from ragas.metrics import (
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )

    print("Configurando RAGAs con Gemini...", end=" ", flush=True)
    ragas_llm, ragas_embeddings = configure_ragas_llm()

    # Inyectar el LLM en cada métrica
    faithfulness.llm           = ragas_llm
    answer_relevancy.llm       = ragas_llm
    answer_relevancy.embeddings = ragas_embeddings  # necesita embeddings para similitud coseno
    context_recall.llm         = ragas_llm
    context_precision.llm      = ragas_llm
    print("✓\n")

    dataset = Dataset.from_dict({
        "question":    [r["question"]     for r in results],
        "answer":      [r["answer"]       for r in results],
        "contexts":    [r["contexts"]     for r in results],
        "ground_truth":[r["ground_truth"] for r in results],
    })

    print("Calculando métricas RAGAs (esto tarda ~1-2 min por cada 10 preguntas)...\n")

    scores = evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy, context_recall, context_precision],
    )

    return {
        "faithfulness":       round(scores["faithfulness"],       4),
        "answer_relevancy":   round(scores["answer_relevancy"],   4),
        "context_recall":     round(scores["context_recall"],     4),
        "context_precision":  round(scores["context_precision"],  4),
    }


# ─── Output ───────────────────────────────────────────────────────────────────

def print_results_table(metrics: dict, results: list[dict]) -> None:
    """Imprime resumen de métricas y latencia promedio en consola."""
    avg_latency = sum(r["latency_s"] for r in results) / len(results)

    print("\n" + "═" * 60)
    print("  RESULTADOS DE EVALUACIÓN — CHATBOT UNCP")
    print("═" * 60)
    print(f"  Preguntas evaluadas : {len(results)}")
    print(f"  Latencia promedio   : {avg_latency:.1f}s por pregunta")
    print("─" * 60)
    print(f"  {'Métrica':<30} {'Score':>8}  {'Interpretación'}")
    print("─" * 60)

    interpretations = {
        "faithfulness":      ("Fidelidad al contexto",    "Alucinaciones detectadas"),
        "answer_relevancy":  ("Relevancia de respuesta",  "Respuestas fuera de tema"),
        "context_recall":    ("Cobertura del contexto",   "Info faltante en retrieval"),
        "context_precision": ("Precisión del contexto",   "Ruido en contexto"),
    }

    for key, score in metrics.items():
        name, low_label = interpretations[key]
        bar = "█" * int(score * 20) + "░" * (20 - int(score * 20))
        status = "✓" if score >= 0.75 else ("⚠" if score >= 0.55 else "✗")
        print(f"  {status} {name:<28} {score:>6.3f}  [{bar}]")

    print("─" * 60)
    print("  ✓ ≥ 0.75 bueno   ⚠ 0.55-0.74 mejorable   ✗ < 0.55 crítico")
    print("═" * 60)

    # Diagnóstico automático
    print("\n  DIAGNÓSTICO:")
    if metrics["faithfulness"] < 0.75:
        print("  → Faithfulness bajo: el LLM alucina. Revisar el SYSTEM_PROMPT.")
    if metrics["answer_relevancy"] < 0.75:
        print("  → Answer Relevancy bajo: respuestas fuera de tema. Revisar el prompt.")
    if metrics["context_recall"] < 0.75:
        print("  → Context Recall bajo: retrieval no encuentra info. Revisar embeddings/chunks.")
    if metrics["context_precision"] < 0.75:
        print("  → Context Precision bajo: mucho ruido en contexto. Activar/ajustar reranking.")
    if all(v >= 0.75 for v in metrics.values()):
        print("  → Todas las métricas son buenas. El sistema funciona correctamente.")
    print()


def save_results(metrics: dict, results: list[dict]) -> Path:
    """Guarda resultados en JSON y CSV en evaluation/results/."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # ── JSON — detalle completo ───────────────────────────────────────────────
    json_path = RESULTS_DIR / f"{timestamp}.json"
    output = {
        "timestamp":        datetime.now().isoformat(),
        "total_questions":  len(results),
        "metrics":          metrics,
        "avg_latency_s":    round(sum(r["latency_s"] for r in results) / len(results), 2),
        "per_question":     [
            {
                "pregunta":          r["question"],
                "categoria":         r["categoria"],
                "respuesta_bot":     r["answer"],
                "respuesta_esperada":r["ground_truth"],
                "n_contexts":        len(r["contexts"]),
                "latency_s":         r["latency_s"],
            }
            for r in results
        ],
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # ── CSV — para abrir en Excel ─────────────────────────────────────────────
    csv_path = RESULTS_DIR / f"{timestamp}.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "pregunta", "categoria", "respuesta_bot",
            "respuesta_esperada", "n_contexts", "latencia_s",
        ])
        for r in results:
            writer.writerow([
                r["question"], r["categoria"], r["answer"],
                r["ground_truth"], len(r["contexts"]), r["latency_s"],
            ])

    return json_path


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print("─" * 60)
    print("  Evaluación RAGAs — Chatbot UNCP")
    print("─" * 60)

    _check_deps()

    # 1. Cargar dataset
    entries = load_dataset()
    if MAX_QUESTIONS:
        entries = entries[:MAX_QUESTIONS]
        print(f"  (modo prueba: evaluando solo las primeras {MAX_QUESTIONS} preguntas)\n")
    print(f"  Dataset cargado: {len(entries)} preguntas válidas")

    # 2. Ejecutar pipeline RAG para cada pregunta
    results = run_all_questions(entries)

    # 3. Evaluar con RAGAs
    metrics = run_ragas_evaluation(results)

    # 4. Mostrar resultados
    print_results_table(metrics, results)

    # 5. Guardar
    json_path = save_results(metrics, results)
    print(f"  Resultados guardados en:")
    print(f"    {json_path}")
    print(f"    {json_path.with_suffix('.csv')}  ← abre en Excel")
    print("─" * 60)


if __name__ == "__main__":
    main()
