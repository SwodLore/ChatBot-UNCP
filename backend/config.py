from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM
    LLM_PROVIDER: str = "gemini"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.1-flash-lite-preview"
    OLLAMA_BASE_URL: str = "http://host.docker.internal:11434"
    OLLAMA_MODEL: str = "gemma3:12b"
    # Ventana de contexto — el default de Ollama (4096) trunca el prompt RAG
    # (8 chunks padre ≈ 3200 tokens + historial + system prompt)
    OLLAMA_NUM_CTX: int = 8192

    # ChromaDB
    CHROMA_HOST: str = "chromadb"
    CHROMA_PORT: int = 8000

    # Embeddings y RAG
    EMBEDDING_MODEL: str = "paraphrase-multilingual-mpnet-base-v2"
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50
    TOP_K_RESULTS: int = 8

    # Historial de conversación — sliding window
    # 6 = últimos 3 intercambios (user + assistant × 3)
    HISTORY_WINDOW: int = 6

    # SQLite — historial persistente de conversaciones
    DB_PATH: str = "/app/chatbot.db"

    # Reranking con Cross-Encoder
    # Poner RERANKER_ENABLED=false en .env para desactivar si el CPU es muy lento
    RERANKER_ENABLED: bool = True
    RERANKER_MODEL: str = "BAAI/bge-reranker-v2-m3"
    # Chunks que pide a ChromaDB antes de rerankear — luego se reducen a TOP_K_RESULTS
    RERANKER_CANDIDATES: int = 20
    # Umbral de relevancia sobre el mejor rerank_score. La escala es 0-1
    # (sentence-transformers aplica sigmoide al logit del cross-encoder).
    # Si ningún chunk lo supera, la pregunta no trata de los documentos indexados
    # (saludo, ruido, tema ajeno) y se responde con un mensaje fijo sin llamar al LLM.
    # Medido con bge-reranker-v2-m3: ruido puntúa ~0.0, preguntas reales > 0.3.
    RERANKER_MIN_SCORE: float = 0.1

    # Parent-Child Chunking (tamaño en caracteres, no tokens; ~4 chars = 1 token)
    # HIJO — texto indexado en ChromaDB para retrieval preciso (~100 tokens)
    CHILD_CHUNK_SIZE: int = 400
    CHILD_CHUNK_OVERLAP: int = 80
    # PADRE — texto pasado al LLM para contexto completo (~400 tokens)
    PARENT_CHUNK_SIZE: int = 1600
    PARENT_CHUNK_OVERLAP: int = 100

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
