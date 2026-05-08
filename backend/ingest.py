"""
Pipeline de ingestion de documentos para el chatbot UNCP.

Formatos soportados:
    ✅ PDF normal       (.pdf)             — pdfplumber
    ✅ PDF escaneado    (.pdf)             — pdfplumber + OCR automático por página
    ✅ Word             (.docx)            — python-docx
    ✅ Excel            (.xlsx)            — openpyxl
    ✅ Imagen           (.png/.jpg/.jpeg)  — pytesseract

Auto-detección: si pdfplumber no extrae texto en una página (PDF escaneado),
se aplica OCR con Tesseract automáticamente. No requiere intervención manual.

Uso:
    docker compose exec backend python ingest.py
"""
import sys
import hashlib
import logging
from datetime import datetime
from pathlib import Path

import pdfplumber
import pytesseract
from PIL import Image
from pdf2image import convert_from_path
from docx import Document
import openpyxl
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
import chromadb

from config import get_settings

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

settings = get_settings()
DOCUMENTS_DIR = Path(__file__).parent / "documents"
COLLECTION_NAME = "uncp_docs"

# Extensiones activas → función extractora
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg"}


# ─── Categorías de documentos ─────────────────────────────────────────────────
# Mapea palabras clave del nombre de archivo → categoría semántica.
# Estas categorías se guardan en metadata de cada chunk y permiten filtrar
# la búsqueda en ChromaDB según el intento detectado en la pregunta del estudiante.
#
# Para agregar una categoría nueva:
#   1. Añade una entrada aquí con las palabras clave del nombre del archivo
#   2. Añade los patrones de intent correspondientes en INTENT_PATTERNS de rag.py
CATEGORY_MAP: dict[str, list[str]] = {
    "calendario":  ["calendario", "academico", "académico", "lectivo", "semestre"],
    "matricula":   ["matricula",  "matrícula", "inscripcion", "inscripción", "adesa"],
    "tarifario":   ["tarifario",  "arancel",   "tramite",    "trámite",     "costo"],
    "reglamento":  ["reglamento", "norma",     "directiva",  "resolucion",  "estatuto"],
    "grados":      ["grado",      "titulo",    "título",     "sustentacion","egresado", "sigt"],
    "directorio":  ["directorio", "oficina",   "decanato",   "contacto"],
}


def detect_category(filename: str) -> str:
    """
    Detecta la categoría de un documento por palabras clave en su nombre.

    Ejemplos:
        "CALENDARIO_ACADEMICO_2026.pdf"  → "calendario"
        "REGLAMENTO_MATRICULA.pdf"       → "matricula"
        "TARIFARIO_TRAMITES_2026.pdf"    → "tarifario"
        "GUIA_SISTEMA_ADESA.pdf"         → "matricula"
        "REGLAMENTO_GRADOS_TITULOS.pdf"  → "grados"
        "otro_documento.pdf"             → "general"
    """
    name_lower = filename.lower()
    for category, keywords in CATEGORY_MAP.items():
        if any(kw in name_lower for kw in keywords):
            return category
    return "general"


# ─── ChromaDB ─────────────────────────────────────────────────────────────────

def get_collection() -> chromadb.Collection:
    client = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


# ─── Extractores de texto ─────────────────────────────────────────────────────

TABLE_ROWS_PER_CHUNK = 8  # filas por chunk en PDFs tabulares
OCR_DPI = 200             # resolución para renderizar páginas escaneadas
OCR_LANG = "spa"          # idioma Tesseract (español)
OCR_MIN_CHARS = 20        # si pdfplumber extrae menos de esto, se considera escaneado


def _ocr_page_image(image: Image.Image) -> str:
    """Aplica Tesseract sobre una imagen PIL y devuelve el texto extraído."""
    return pytesseract.image_to_string(image, lang=OCR_LANG, config="--psm 6")


def extract_pdf(path: Path) -> list[dict]:
    """
    Extrae texto de PDFs con estrategia triple + OCR automático:

    1. PDF tabular  → extract_tables() → filas "COL1 | COL2"
    2. PDF de texto → extract_text() normal
    3. PDF escaneado → pdfplumber no retorna texto → OCR con Tesseract por página

    La detección es automática página a página: si pdfplumber extrae menos de
    OCR_MIN_CHARS caracteres, esa página se renderiza a imagen y se aplica OCR.
    Esto permite PDFs mixtos (algunas páginas con texto, otras escaneadas).
    """
    pages = []

    # Pre-renderizar todo el PDF a imágenes solo si se va a necesitar OCR.
    # Se hace lazy: solo si alguna página no tiene texto suficiente.
    _rendered: list[Image.Image] | None = None

    def _get_rendered() -> list[Image.Image]:
        nonlocal _rendered
        if _rendered is None:
            logger.info(f"  🔍 Renderizando PDF para OCR ({path.name})...")
            _rendered = convert_from_path(str(path), dpi=OCR_DPI)
        return _rendered

    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            page_num = i + 1
            tables = page.extract_tables()

            if tables:
                # Estrategia 1: tabular
                all_rows: list[str] = []
                for table in tables:
                    for row in table:
                        cells = [
                            str(c).strip()
                            for c in row
                            if c and str(c).strip() and str(c).strip() != "None"
                        ]
                        if len(cells) >= 2:
                            all_rows.append(" | ".join(cells))

                for j in range(0, len(all_rows), TABLE_ROWS_PER_CHUNK):
                    group = all_rows[j : j + TABLE_ROWS_PER_CHUNK]
                    pages.append({"text": "\n".join(group), "page": page_num})

            else:
                text = page.extract_text() or ""

                if len(text.strip()) >= OCR_MIN_CHARS:
                    # Estrategia 2: texto normal
                    pages.append({"text": text.strip(), "page": page_num})
                else:
                    # Estrategia 3: página escaneada → OCR
                    logger.info(f"  🔍 Pág. {page_num}: sin texto — aplicando OCR...")
                    rendered = _get_rendered()
                    if i < len(rendered):
                        ocr_text = _ocr_page_image(rendered[i])
                        if ocr_text.strip():
                            pages.append({"text": ocr_text.strip(), "page": page_num})
                        else:
                            logger.info(f"  ⚠  Pág. {page_num}: OCR no extrajo texto (imagen muy borrosa?)")

    return pages


def extract_docx(path: Path) -> list[dict]:
    """Word .docx: extrae párrafos y tablas, tratado como una sola página."""
    doc = Document(path)
    parts = []

    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text.strip())

    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(
                cell.text.strip() for cell in row.cells if cell.text.strip()
            )
            if row_text:
                parts.append(row_text)

    if not parts:
        return []
    return [{"text": "\n".join(parts), "page": 1}]


def extract_xlsx(path: Path) -> list[dict]:
    """Excel .xlsx: cada hoja es una 'página', convierte celdas a texto."""
    wb = openpyxl.load_workbook(path, data_only=True)
    pages = []
    for i, sheet in enumerate(wb.worksheets):
        rows = []
        for row in sheet.iter_rows(values_only=True):
            row_str = " | ".join(str(v) for v in row if v is not None and str(v).strip())
            if row_str:
                rows.append(row_str)
        if rows:
            pages.append({"text": "\n".join(rows), "page": i + 1})
    return pages


def extract_image(path: Path) -> list[dict]:
    """Imagen JPG/PNG: OCR con Tesseract en español."""
    img = Image.open(path)
    text = pytesseract.image_to_string(img, lang=OCR_LANG, config="--psm 6")
    return [{"text": text.strip(), "page": 1}] if text.strip() else []


def get_extractor(path: Path):
    """Devuelve la función extractora correcta según la extensión del archivo."""
    ext = path.suffix.lower()
    extractors = {
        ".pdf":  extract_pdf,
        ".docx": extract_docx,
        ".xlsx": extract_xlsx,
        ".png":  extract_image,
        ".jpg":  extract_image,
        ".jpeg": extract_image,
    }
    return extractors.get(ext)


# ─── Chunking ─────────────────────────────────────────────────────────────────

def make_chunks(pages: list[dict], filename: str) -> list[dict]:
    """
    Parent-Child Chunking: divide el texto en dos niveles.

    PADRE (~1600 chars / 400 tokens):
        Fragmento con contexto suficiente para que el LLM genere una respuesta completa.

    HIJO (~400 chars / 100 tokens):
        Sub-fragmento del padre. Se indexa en ChromaDB como embedding.
        Vector más enfocado → mayor precisión en retrieval.

    Flujo en consultas:
        Query → embedding → busca HIJOS en ChromaDB (preciso)
               → recupera PADRE del hijo encontrado → pasa PADRE al LLM (contexto rico)

    Cada chunk almacenado en ChromaDB es un hijo, con el padre en su metadata.
    """
    parent_splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.PARENT_CHUNK_SIZE,
        chunk_overlap=settings.PARENT_CHUNK_OVERLAP,
        separators=["\n\n", "\n", ".", " ", ""],
    )
    child_splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.CHILD_CHUNK_SIZE,
        chunk_overlap=settings.CHILD_CHUNK_OVERLAP,
        separators=["\n\n", "\n", ".", " ", ""],
    )

    ingested_at = datetime.now().isoformat()
    category    = detect_category(filename)
    chunks      = []

    for page_data in pages:
        parents = parent_splitter.split_text(page_data["text"])

        for p_idx, parent_text in enumerate(parents):
            parent_id = hashlib.md5(
                f"{filename}|p{page_data['page']}|par{p_idx}".encode()
            ).hexdigest()

            children = child_splitter.split_text(parent_text)

            for c_idx, child_text in enumerate(children):
                chunk_id = hashlib.md5(
                    f"{filename}|p{page_data['page']}|par{p_idx}|ch{c_idx}|{child_text[:30]}".encode()
                ).hexdigest()
                chunks.append({
                    "id": chunk_id,
                    "text": child_text,
                    "metadata": {
                        "source":      filename,
                        "page":        page_data["page"],
                        "category":    category,      # ← filtro semántico en ChromaDB
                        "parent_id":   parent_id,
                        "parent_text": parent_text,
                        "ingested_at": ingested_at,
                    },
                })

    return chunks


# ─── Deduplicación ────────────────────────────────────────────────────────────

def remove_existing(collection: chromadb.Collection, filename: str) -> int:
    """Elimina chunks previos del mismo archivo para re-ingestion limpia."""
    existing = collection.get(where={"source": {"$eq": filename}})
    if existing["ids"]:
        collection.delete(ids=existing["ids"])
        return len(existing["ids"])
    return 0


# ─── Ingestion de un archivo ──────────────────────────────────────────────────

def ingest_one(
    file_path: Path,
    model: SentenceTransformer,
    collection: chromadb.Collection,
) -> dict:
    filename = file_path.name
    extractor = get_extractor(file_path)

    if extractor is None:
        return {"file": filename, "status": "skip", "reason": "formato no soportado"}

    removed = remove_existing(collection, filename)
    if removed:
        logger.info(f"  ↺  {removed} chunks previos eliminados (re-indexando)")

    pages = extractor(file_path)
    if not pages:
        return {"file": filename, "status": "skip", "reason": "sin texto extraíble"}

    chunks = make_chunks(pages, filename)
    texts = [c["text"] for c in chunks]
    category = chunks[0]["metadata"]["category"] if chunks else "general"

    logger.info(f"  🏷  Categoría detectada: {category}")
    logger.info(f"  ⚙  Generando {len(chunks)} embeddings ({len(pages)} páginas)...")
    embeddings = model.encode(texts, batch_size=32, show_progress_bar=False).tolist()

    collection.add(
        ids=[c["id"] for c in chunks],
        embeddings=embeddings,
        documents=texts,
        metadatas=[c["metadata"] for c in chunks],
    )
    return {"file": filename, "status": "ok", "pages": len(pages), "chunks": len(chunks)}


# ─── Verificación de búsqueda ─────────────────────────────────────────────────

def verify_search(model: SentenceTransformer, collection: chromadb.Collection) -> None:
    """Prueba rápida de búsqueda semántica al finalizar."""
    query = "requisitos matrícula plazo pago"
    count = collection.count()
    if count == 0:
        return
    embedding = model.encode(query).tolist()
    results = collection.query(
        query_embeddings=[embedding],
        n_results=min(2, count),
    )
    logger.info(f'\nVerificación — query: "{query}"')
    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        preview = doc[:120].replace("\n", " ")
        logger.info(f'  → [{meta["source"]} | pág. {meta["page"]}]')
        logger.info(f'     "{preview}..."')


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    all_files = [
        f for f in sorted(DOCUMENTS_DIR.iterdir())
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
    ]

    if not all_files:
        logger.info("─" * 50)
        logger.info("No hay documentos en backend/documents/")
        logger.info(f"Formatos soportados: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")
        logger.info("\nPasos:")
        logger.info("  1. Copia tus archivos a backend/documents/")
        logger.info("  2. Corre: docker compose exec backend python ingest.py")
        logger.info("─" * 50)
        sys.exit(0)

    logger.info("─" * 50)
    logger.info(f"Modelo: {settings.EMBEDDING_MODEL}")
    logger.info("(Primera vez descarga ~420 MB — puede tardar unos minutos)")
    logger.info("─" * 50)
    model = SentenceTransformer(settings.EMBEDDING_MODEL)
    collection = get_collection()

    # Mostrar conteo por tipo
    by_ext: dict[str, int] = {}
    for f in all_files:
        by_ext[f.suffix.lower()] = by_ext.get(f.suffix.lower(), 0) + 1
    summary = " | ".join(f"{ext}: {n}" for ext, n in sorted(by_ext.items()))
    logger.info(f"\nArchivos encontrados: {len(all_files)} ({summary})\n")

    results = []
    for file_path in all_files:
        icon = {"pdf": "📄", "docx": "📝", "xlsx": "📊", "png": "🖼", "jpg": "🖼", "jpeg": "🖼"}.get(
            file_path.suffix.lower().lstrip("."), "📁"
        )
        logger.info(f"{icon} {file_path.name}")
        result = ingest_one(file_path, model, collection)
        results.append(result)
        if result["status"] == "ok":
            logger.info(f"  ✓  {result['chunks']} chunks indexados\n")
        else:
            logger.info(f"  ✗  Omitido: {result.get('reason')}\n")

    ok = [r for r in results if r["status"] == "ok"]
    total_chunks = sum(r["chunks"] for r in ok)

    logger.info("─" * 50)
    logger.info(f"Indexados    : {len(ok)} / {len(all_files)} archivos")
    logger.info(f"Total chunks : {total_chunks} en ChromaDB")

    if total_chunks > 0:
        verify_search(model, collection)

    logger.info("\n✅ Ingestion completa.")
    logger.info("─" * 50)


if __name__ == "__main__":
    main()
