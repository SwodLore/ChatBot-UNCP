# Chatbot UNCP — Asistente Virtual Estudiantil

Chatbot RAG (Retrieval-Augmented Generation) para la **Universidad Nacional del Centro del Perú**. Permite a los estudiantes consultar información administrativa (trámites, requisitos, calendario académico, tarifarios, reglamentos) 24/7, basándose en documentos PDF institucionales oficiales.

> Proyecto de tesis — Ingeniería de Sistemas, UNCP, Huancayo 2026.

---

## Inicio rápido

### Requisitos previos

| Herramienta | Versión mínima | Descarga |
|---|---|---|
| Docker Desktop | 24+ | https://www.docker.com/products/docker-desktop |
| Git | cualquiera | https://git-scm.com |
| Cuenta Google AI Studio | — | https://aistudio.google.com (para obtener API key gratis) |

### 3 pasos para correrlo

**Paso 1 — Clonar y configurar**

```bash
git clone https://github.com/TU_USUARIO/chatbot-uncp.git
cd chatbot-uncp
cp .env.example .env
```

Abre `.env` y reemplaza `tu_api_key_aqui` con tu clave de Google AI Studio:

```env
GEMINI_API_KEY=AIzaSy...tu_clave_real
```

**Paso 2 — Construir y levantar todo**

```bash
docker compose up -d --build
```

Este único comando:
- Construye las imágenes del backend (Python + Tesseract OCR) y frontend (React)
- Levanta ChromaDB, el backend FastAPI y el frontend Vite
- Descarga automáticamente los modelos de embeddings (~420 MB) y reranker (~280 MB) en el primer arranque

Espera hasta que el backend esté listo (aproximadamente 2–5 minutos la primera vez):

```bash
docker compose logs -f backend
# Espera ver: INFO: Application startup complete.
```

**Paso 3 — Indexar los documentos**

Copia tus PDFs institucionales a `backend/documents/` y ejecuta:

```bash
docker compose exec backend python ingest.py
```

El sistema detecta automáticamente si un PDF es de texto o está escaneado y aplica OCR si es necesario.

### Acceder a la aplicación

| Servicio | URL |
|---|---|
| Chatbot (estudiantes) | http://localhost:3000 |
| Administración (documentos) | http://localhost:3000/admin |
| Historial de conversaciones | http://localhost:3000/history |
| API / Swagger | http://localhost:8000/docs |
| Health check | http://localhost:8000/api/health |

---

## Agregar o actualizar documentos

### Opción A — Desde la interfaz web (recomendado)

Abre http://localhost:3000/admin → sección **Subir nuevo documento** → arrastra el archivo.

### Opción B — Desde la terminal (para múltiples archivos)

```bash
# Copiar archivos a la carpeta de documentos
cp *.pdf backend/documents/

# Indexar (procesa solo los archivos nuevos o modificados)
docker compose exec backend python ingest.py
```

Formatos soportados: `.pdf` (texto y escaneados con OCR), `.docx`, `.xlsx`

---

## Comandos útiles

```bash
# Ver estado de los contenedores
docker compose ps

# Ver logs en tiempo real
docker compose logs -f backend
docker compose logs -f frontend

# Parar todo
docker compose down

# Parar y limpiar todo (incluyendo base de datos y vectores)
docker compose down -v

# Reconstruir solo el backend (tras cambios en requirements.txt o Dockerfile)
docker compose build --no-cache backend
docker compose up -d backend

# Diagnóstico de búsqueda (ver qué chunks recupera para una pregunta)
curl "http://localhost:8000/api/debug/search?q=cuando+inicia+el+semestre"

# Correr evaluación RAGAs (requiere test_dataset.json completado)
docker compose exec backend python evaluate.py
```

---

## Estructura del proyecto

```
chatbot-uncp/
├── .env.example             ← plantilla de variables de entorno
├── docker-compose.yml       ← orquestación de servicios
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py              ← API FastAPI (endpoints, streaming SSE)
│   ├── rag.py               ← pipeline RAG: retrieval + reranking + generación
│   ├── ingest.py            ← procesador de documentos (PDF, DOCX, XLSX, OCR)
│   ├── database.py          ← historial de conversaciones en SQLite
│   ├── config.py            ← variables de entorno y configuración
│   ├── evaluate.py          ← evaluación sistemática con RAGAs
│   ├── documents/           ← PDFs institucionales (no van en git)
│   └── evaluation/
│       └── test_dataset.json ← preguntas para evaluación RAGAs
│
└── frontend/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── App.tsx
        ├── components/
        │   ├── ChatWindow.tsx      ← interfaz principal del chat
        │   ├── MessageBubble.tsx   ← renderizado de mensajes con Markdown
        │   └── SuggestedQuestions.tsx
        ├── pages/
        │   ├── AdminPage.tsx       ← gestión de documentos
        │   └── HistoryPage.tsx     ← historial de conversaciones SQLite
        └── hooks/
            └── useStreamingChat.ts ← lógica SSE + persistencia de sesión
```

---

## Variables de entorno

Todas las variables se configuran en `.env` (copiar desde `.env.example`).

| Variable | Por defecto | Descripción |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | Proveedor LLM: `gemini` (desarrollo) o `ollama` (producción) |
| `GEMINI_API_KEY` | — | API key de Google AI Studio (gratis en aistudio.google.com) |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Modelo Gemini a usar |
| `OLLAMA_MODEL` | `llama3.1:8b` | Modelo Ollama (requiere ≥ 8 GB RAM) |
| `EMBEDDING_MODEL` | `paraphrase-multilingual-mpnet-base-v2` | Modelo de embeddings multilingüe |
| `TOP_K_RESULTS` | `8` | Chunks recuperados por consulta (tras reranking) |
| `RERANKER_ENABLED` | `true` | Activar Cross-Encoder reranking |
| `RERANKER_MODEL` | `BAAI/bge-reranker-v2-m3` | Modelo reranker (~280 MB) |
| `RERANKER_CANDIDATES` | `20` | Candidatos que evalúa el reranker antes de filtrar a TOP_K |
| `CHILD_CHUNK_SIZE` | `400` | Tamaño del chunk hijo en chars (indexado en ChromaDB) |
| `PARENT_CHUNK_SIZE` | `1600` | Tamaño del chunk padre en chars (enviado al LLM) |
| `HISTORY_WINDOW` | `6` | Mensajes de historial que ve el LLM (3 intercambios) |
| `DB_PATH` | `/app/chatbot.db` | Ruta del SQLite con historial de conversaciones |

> Después de cambiar `CHILD_CHUNK_SIZE` o `PARENT_CHUNK_SIZE` hay que re-ingestar todos los documentos.

---

## Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Enviar consulta — responde en streaming SSE |
| `GET` | `/api/sessions` | Listar últimas 50 sesiones |
| `GET` | `/api/sessions/{id}` | Mensajes de una sesión |
| `GET` | `/api/documents` | Listar documentos indexados en ChromaDB |
| `POST` | `/api/ingest` | Subir y procesar un documento |
| `DELETE` | `/api/documents/{name}` | Eliminar documento de ChromaDB |
| `GET` | `/api/health` | Estado de ChromaDB, LLM y chunks indexados |
| `GET` | `/api/debug/search?q=` | Diagnóstico: ver qué chunks recupera una query |

Documentación interactiva completa en http://localhost:8000/docs

---

## Arquitectura RAG

```
Documento PDF/DOCX/XLSX
    → Extracción de texto (pdfplumber / python-docx / openpyxl)
    → OCR automático si la página está escaneada (Tesseract + español)
    → Parent-Child Chunking (hijo 400 chars para embeddings, padre 1600 chars para LLM)
    → sentence-transformers paraphrase-multilingual-mpnet-base-v2 (embeddings)
    → ChromaDB (vectores persistentes)

Consulta del estudiante
    → Clasificación de intento (calendario / matrícula / tarifario / reglamento / grados)
    → Filtro semántico en ChromaDB por categoría del documento
    → Retrieval top-20 chunks + Cross-Encoder reranking → top-8
    → Historial de conversación (últimos 6 mensajes desde SQLite)
    → Prompt con contexto + historial → Gemini 2.0 Flash / LLaMA 3.1
    → Respuesta en streaming SSE → frontend React
```

---

## Cambiar entre Gemini (desarrollo) y Ollama (producción)

**Gemini** — gratis, rápido, requiere internet:
```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...
```

**Ollama** — privacidad total, sin costo, funciona offline (requiere ≥ 8 GB RAM):
```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.1:8b
```

Solo se cambia `.env` — no se toca ningún archivo de código.

---

## Evaluación con RAGAs

El sistema incluye evaluación sistemática de calidad RAG con 4 métricas:

- **Faithfulness** — el LLM no alucina, solo afirma lo que está en el contexto
- **Answer Relevancy** — la respuesta responde exactamente lo que se preguntó
- **Context Recall** — el retrieval encontró toda la información necesaria
- **Context Precision** — el contexto recuperado no contiene ruido innecesario

```bash
# 1. Completar preguntas y respuestas esperadas en:
#    backend/evaluation/test_dataset.json

# 2. Correr evaluación (tarda ~1-2 min por cada 10 preguntas)
docker compose exec backend python evaluate.py

# Los resultados se guardan en backend/evaluation/results/
# como JSON (detalle completo) y CSV (abrir en Excel)
```

---

Ingeniería de Sistemas — Universidad Nacional del Centro del Perú, Huancayo 2026.
