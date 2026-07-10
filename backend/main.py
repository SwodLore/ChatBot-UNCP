import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import chromadb
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import get_settings
from database import (
    ensure_session,
    get_session_history,
    get_session_messages,
    init_db,
    list_sessions,
    save_message,
)
from rag import get_embedding_model, get_reranker, stream_rag_response

settings = get_settings()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ─── Startup ──────────────────────────────────────────────────────────────────

def _wait_for_chroma(retries: int = 10, delay: int = 3) -> None:
    """Espera a que ChromaDB esté listo antes de aceptar requests."""
    for attempt in range(1, retries + 1):
        try:
            chromadb.HttpClient(
                host=settings.CHROMA_HOST, port=settings.CHROMA_PORT
            ).heartbeat()
            logger.info("ChromaDB listo.")
            return
        except Exception:
            logger.info(f"Esperando ChromaDB... intento {attempt}/{retries}")
            time.sleep(delay)
    logger.warning("ChromaDB no respondió — el backend arranca de todas formas.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Esperar ChromaDB
    _wait_for_chroma()

    # 2. Pre-cargar modelo de embeddings (evita latencia en la primera consulta)
    try:
        logger.info("Pre-cargando modelo de embeddings...")
        get_embedding_model()
    except Exception as e:
        logger.warning(f"No se pudo pre-cargar el modelo de embeddings: {e}")

    # 3. Pre-cargar reranker Cross-Encoder (280 MB, se descarga en hf_cache)
    if settings.RERANKER_ENABLED:
        try:
            logger.info("Pre-cargando reranker Cross-Encoder...")
            get_reranker()
        except Exception as e:
            logger.warning(f"No se pudo pre-cargar el reranker: {e}")

    # 4. Inicializar base de datos SQLite para historial de conversaciones
    init_db(settings.DB_PATH)
    logger.info(f"SQLite inicializado en {settings.DB_PATH}")

    yield


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Chatbot UNCP — API",
    description=(
        "Backend RAG para atención estudiantil automatizada.\n\n"
        "**Flujo del chatbot:**\n"
        "1. `POST /api/chat` → el estudiante envía su pregunta\n"
        "2. El sistema busca fragmentos relevantes en ChromaDB\n"
        "3. El LLM genera la respuesta basada en documentos UNCP reales\n"
        "4. La respuesta llega en streaming token a token"
    ),
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/files", StaticFiles(directory="documents"), name="files")


# ─── Helpers internos ─────────────────────────────────────────────────────────

def _chroma_client() -> chromadb.HttpClient:
    return chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)


def _get_collection() -> chromadb.Collection:
    return _chroma_client().get_or_create_collection(
        "uncp_docs", metadata={"hnsw:space": "cosine"}
    )


async def _check_llm() -> str:
    if settings.LLM_PROVIDER == "gemini":
        if not settings.GEMINI_API_KEY:
            return "error: GEMINI_API_KEY no configurada"
        return f"ok ({settings.GEMINI_MODEL})"

    if settings.LLM_PROVIDER == "ollama":
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
                response.raise_for_status()
                models = [m["name"] for m in response.json().get("models", [])]
                if any(settings.OLLAMA_MODEL in name for name in models):
                    return f"ok ({settings.OLLAMA_MODEL} disponible)"
                return f"warning: modelo no encontrado. Disponibles: {models}"
        except httpx.ConnectError:
            return f"error: no se puede conectar a Ollama en {settings.OLLAMA_BASE_URL}"
        except Exception as e:
            return f"error: {e}"

    return f"error: proveedor desconocido '{settings.LLM_PROVIDER}'"


# ─── Debug ────────────────────────────────────────────────────────────────────

@app.get("/api/debug/search", tags=["Debug"])
async def debug_search(q: str):
    """
    Muestra exactamente qué chunks recupera ChromaDB para una query.
    Úsalo para diagnosticar por qué el chatbot no encuentra una respuesta.

    Ejemplo: GET /api/debug/search?q=cuando inicia el semestre 2026-2
    """
    from rag import classify_intent, retrieve_chunks, _expand_query
    expanded   = _expand_query(q)
    categories = classify_intent(q)
    chunks     = retrieve_chunks(q, category_filter=categories or None)
    return {
        "query_original":        q,
        "categorias_detectadas": categories,
        "query_expandida": expanded,
        "total_chunks_recuperados": len(chunks),
        "chunks": [
            {
                "rank": i + 1,
                "score": c["score"],
                "source": c["metadata"]["source"],
                "page": c["metadata"]["page"],
                "texto": c["document"],
            }
            for i, c in enumerate(chunks)
        ],
    }


# ─── Chat ─────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None   # UUID generado en el frontend


async def _stream_with_persistence(
    session_id: str,
    question: str,
    history: list[dict],
) -> AsyncGenerator[str, None]:
    """
    Wrapper sobre stream_rag_response que guarda los mensajes en SQLite.
    Guarda el mensaje del usuario antes de empezar y la respuesta completa al terminar.
    """
    await asyncio.to_thread(save_message, session_id, "user", question)

    accumulated: list[str] = []
    sources: list | None = None
    async for event_str in stream_rag_response(question, history):
        yield event_str
        # Acumular tokens y fuentes para guardar la respuesta completa al final
        if event_str.startswith("data: "):
            try:
                data = json.loads(event_str[6:].strip())
                if data.get("type") == "delta":
                    accumulated.append(data.get("content", ""))
                elif data.get("type") == "sources":
                    sources = data.get("sources") or None
            except Exception:
                pass

    full_response = "".join(accumulated)
    if full_response:
        # Las fuentes se guardan como JSON junto al mensaje para que la UI
        # siga mostrando los badges (PDF, página, % confianza) tras un F5
        await asyncio.to_thread(
            save_message,
            session_id,
            "assistant",
            full_response,
            json.dumps(sources, ensure_ascii=False) if sources else None,
        )


@app.post(
    "/api/chat",
    tags=["Chat"],
    summary="Enviar consulta al chatbot",
    response_description="Stream de tokens SSE con la respuesta y las fuentes",
)
async def chat(request: ChatRequest):
    """
    Recibe la pregunta del estudiante y devuelve la respuesta en streaming.

    Si se pasa `session_id`, el historial se carga desde SQLite y la conversación
    se guarda automáticamente. Si no se pasa, funciona sin persistencia.

    **Body:**
    ```json
    { "message": "¿Y cuánto cuesta?", "session_id": "uuid-de-la-sesion" }
    ```

    **Formato de respuesta (Server-Sent Events):**
    ```
    data: {"type": "delta",   "content": "Los requisitos son..."}
    data: {"type": "sources", "sources": [{"file": "reglamento.pdf", "page": 3, "score": 0.92}]}
    data: {"type": "done"}
    ```
    """
    _sse_headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }

    if request.session_id:
        await asyncio.to_thread(ensure_session, request.session_id)
        history = await asyncio.to_thread(
            get_session_history, request.session_id, settings.HISTORY_WINDOW
        )
        generator = _stream_with_persistence(request.session_id, request.message, history)
    else:
        generator = stream_rag_response(request.message)

    return StreamingResponse(generator, media_type="text/event-stream", headers=_sse_headers)


# ─── Conversaciones ───────────────────────────────────────────────────────────

@app.get(
    "/api/sessions/{session_id}",
    tags=["Conversaciones"],
    summary="Recuperar mensajes de una sesión",
)
async def get_session(session_id: str):
    """
    Devuelve todos los mensajes de una sesión en orden cronológico.
    El frontend lo usa al cargar la página para restaurar la conversación tras un F5.
    """
    messages = await asyncio.to_thread(get_session_messages, session_id, 100)
    return {"session_id": session_id, "messages": messages}


@app.get(
    "/api/sessions",
    tags=["Conversaciones"],
    summary="Listar sesiones recientes",
)
async def get_sessions():
    """
    Lista las últimas 50 sesiones con conteo de mensajes.
    Útil para analytics: ver cuántas consultas hace cada sesión.
    """
    sessions = await asyncio.to_thread(list_sessions, 50)
    return {"sessions": sessions, "total": len(sessions)}


# ─── Gestión de documentos ────────────────────────────────────────────────────

@app.get(
    "/api/documents",
    tags=["Documentos"],
    summary="Listar documentos indexados",
)
async def list_documents():
    """
    Devuelve todos los documentos cargados en ChromaDB con sus estadísticas.

    Útil para el panel de administración y para verificar qué conoce el chatbot.
    """
    collection = _get_collection()
    results = collection.get(include=["metadatas"])

    docs: dict[str, dict] = {}
    for meta in results["metadatas"]:
        source = meta["source"]
        if source not in docs:
            docs[source] = {
                "file": source,
                "chunks": 0,
                "ingested_at": meta.get("ingested_at", ""),
            }
        docs[source]["chunks"] += 1

    return {
        "documents": sorted(docs.values(), key=lambda d: d["file"]),
        "total_documents": len(docs),
        "total_chunks": len(results["metadatas"]),
    }


@app.delete(
    "/api/documents/{filename}",
    tags=["Documentos"],
    summary="Eliminar un documento",
)
async def delete_document(filename: str):
    """
    Elimina un documento y todos sus fragmentos de ChromaDB.

    Usar cuando un documento quede desactualizado (nuevo calendario, nuevo tarifario, etc.).
    Después de eliminar, vuelve a correr el ingest con el archivo actualizado.
    """
    collection = _get_collection()
    existing = collection.get(where={"source": {"$eq": filename}})

    if not existing["ids"]:
        raise HTTPException(
            status_code=404,
            detail=f"Documento '{filename}' no encontrado en ChromaDB.",
        )

    collection.delete(ids=existing["ids"])
    return {
        "message": f"Documento '{filename}' eliminado correctamente.",
        "chunks_removed": len(existing["ids"]),
    }


# ─── Subida e indexación de documentos ───────────────────────────────────────

@app.post(
    "/api/ingest",
    tags=["Documentos"],
    summary="Subir y procesar un documento",
)
async def upload_and_ingest(file: UploadFile = File(...)):
    """
    Sube un archivo (.pdf, .docx, .xlsx) y lo indexa automáticamente en ChromaDB.

    El proceso:
    1. Guarda el archivo en `backend/documents/`
    2. Extrae el texto (tablas incluidas para PDFs)
    3. Divide en chunks con solapamiento
    4. Genera embeddings multilingüe
    5. Almacena en ChromaDB (reemplaza versión anterior del mismo archivo)
    """
    from ingest import ingest_one, get_collection as _ingest_collection, SUPPORTED_EXTENSIONS

    filename = file.filename or "upload"
    suffix   = Path(filename).suffix.lower()

    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Formato no soportado. Formatos válidos: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    dest = Path("documents") / filename
    dest.write_bytes(await file.read())

    model      = get_embedding_model()
    collection = _ingest_collection()
    result     = ingest_one(dest, model, collection)

    if result["status"] == "skip":
        raise HTTPException(
            status_code=422,
            detail=result.get("reason", "No se pudo extraer texto del archivo"),
        )

    logger.info(f"Ingest via API: {filename} → {result['chunks']} chunks")
    return result


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get(
    "/api/health",
    tags=["Infraestructura"],
    summary="Estado del sistema",
)
async def health():
    """Verifica el estado de ChromaDB, el LLM y cuántos chunks hay indexados."""
    try:
        _chroma_client().heartbeat()
        chroma_status = "ok"
    except Exception as e:
        chroma_status = f"error: {e}"

    try:
        total_chunks = _get_collection().count()
    except Exception:
        total_chunks = -1

    llm_status = await _check_llm()
    overall = "ok" if chroma_status == "ok" and "error" not in llm_status else "degraded"

    return {
        "status": overall,
        "chromadb": chroma_status,
        "indexed_chunks": total_chunks,
        "llm_provider": settings.LLM_PROVIDER,
        "llm": llm_status,
    }
