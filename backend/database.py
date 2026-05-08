"""
Capa de persistencia SQLite para el historial de conversaciones.

Cada sesión = una pestaña/conversación del estudiante (UUID generado en el frontend).
Los mensajes se guardan en orden cronológico y se pueden recuperar por session_id.

Archivo en disco: /app/chatbot.db  (montado en ./backend/chatbot.db en el host)
"""
import sqlite3
import threading
from pathlib import Path

# Lock global — SQLite en WAL mode maneja bien lecturas concurrentes,
# pero las escrituras se serializan con el lock para evitar "database is locked".
_lock = threading.Lock()
_DB_PATH = ""


def init_db(path: str) -> None:
    """Crea el archivo y las tablas si no existen. Llamar una sola vez al arrancar."""
    global _DB_PATH
    _DB_PATH = path
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id         TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content    TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session_time
                ON messages(session_id, created_at);
        """)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")  # permite lecturas concurrentes durante escritura
    return conn


def ensure_session(session_id: str) -> None:
    """Crea la sesión si no existe. INSERT OR IGNORE es idempotente."""
    with _lock, _connect() as conn:
        conn.execute("INSERT OR IGNORE INTO sessions(id) VALUES (?)", (session_id,))


def save_message(session_id: str, role: str, content: str) -> None:
    """Guarda un mensaje (user o assistant) en la sesión."""
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO messages(session_id, role, content) VALUES (?, ?, ?)",
            (session_id, role, content),
        )


def get_session_history(session_id: str, limit: int = 10) -> list[dict]:
    """
    Retorna los últimos `limit` mensajes en orden cronológico (más viejo primero).
    Usado internamente para construir el contexto que se pasa al LLM.
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM (
                SELECT role, content, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            ) ORDER BY created_at ASC
            """,
            (session_id, limit),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def get_session_messages(session_id: str, limit: int = 100) -> list[dict]:
    """
    Retorna todos los mensajes para restaurar la UI del frontend tras un F5.
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM messages
            WHERE session_id = ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def list_sessions(limit: int = 50) -> list[dict]:
    """
    Lista sesiones recientes con conteo de mensajes.
    Útil para analytics en el panel de administración.
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                s.id,
                s.created_at,
                COUNT(m.id)        AS message_count,
                MAX(m.created_at)  AS last_message_at
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
            GROUP BY s.id
            ORDER BY COALESCE(MAX(m.created_at), s.created_at) DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
