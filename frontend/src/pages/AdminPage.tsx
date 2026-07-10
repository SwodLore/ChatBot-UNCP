import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'

// ── Tipos ────────────────────────────────────────────────────────────────────

interface DocInfo {
  file: string
  chunks: number
  ingested_at: string
}

type UploadStatus =
  | { type: 'idle' }
  | { type: 'uploading' }
  | { type: 'success'; file: string; chunks: number }
  | { type: 'error'; message: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOWED_EXT = ['.pdf', '.docx', '.xlsx']

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf')  return '📄'
  if (ext === 'docx') return '📝'
  if (ext === 'xlsx') return '📊'
  return '📁'
}

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function isAllowed(file: File) {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  return ALLOWED_EXT.includes(ext)
}

// ── Página ────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [docs, setDocs]           = useState<DocInfo[]>([])
  const [totalChunks, setTotal]   = useState(0)
  const [loadingDocs, setLoading] = useState(true)

  const [selectedFile, setFile]       = useState<File | null>(null)
  const [dragOver, setDragOver]       = useState(false)
  const [uploadStatus, setStatus]     = useState<UploadStatus>({ type: 'idle' })

  const [confirmDelete, setConfirm]   = useState<string | null>(null)
  const [deleting, setDeleting]       = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Carga de documentos ──────────────────────────────────────────────────

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/documents')
      const data = await res.json()
      setDocs(data.documents ?? [])
      setTotal(data.total_chunks ?? 0)
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // ── Upload ────────────────────────────────────────────────────────────────

  const pickFile = (f: File | undefined) => {
    if (f && isAllowed(f)) {
      setFile(f)
      setStatus({ type: 'idle' })
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    pickFile(e.dataTransfer.files[0])
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setStatus({ type: 'uploading' })

    try {
      const form = new FormData()
      form.append('file', selectedFile)

      const res = await fetch('/api/ingest', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Error ${res.status}`)
      }

      const result = await res.json()
      setStatus({ type: 'success', file: result.file, chunks: result.chunks })
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      fetchDocs()
    } catch (err) {
      setStatus({ type: 'error', message: String(err) })
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (filename: string) => {
    setDeleting(filename)
    try {
      await fetch(`/api/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      setConfirm(null)
      fetchDocs()
    } finally {
      setDeleting(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header minimalista (misma temática que el chat) ── */}
      <header className="bg-white border-b border-gray-100 px-3 sm:px-4 py-2.5 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <Link
            to="/"
            title="Volver al chat"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm text-gray-800 leading-tight truncate">
              Administrar documentos
            </h1>
            <p className="text-[10px] text-gray-400 truncate">
              Base de conocimiento del Asistente Virtual UNCP
            </p>
          </div>
          <div className="w-9 h-9 rounded-full bg-uncp-dark overflow-hidden ring-1 ring-uncp-gold/40 flex-shrink-0">
            <img src="/uncp-logo.png" alt="UNCP" className="w-full h-full object-contain" />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── Subir documento ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <span className="text-lg">📤</span> Subir nuevo documento
            </h2>
            <p className="text-gray-400 text-xs mt-0.5">
              El archivo se indexará automáticamente en ChromaDB
            </p>
          </div>

          <div className="px-5 sm:px-6 py-5 space-y-4">
            {/* Zona drag & drop */}
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 sm:p-10 text-center cursor-pointer transition-all select-none ${
                dragOver
                  ? 'border-uncp-green bg-uncp-green/5 scale-[1.01]'
                  : selectedFile
                    ? 'border-uncp-green/60 bg-uncp-green/5'
                    : 'border-gray-200 hover:border-uncp-green/40 hover:bg-gray-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx"
                className="hidden"
                onChange={e => pickFile(e.target.files?.[0])}
              />

              {selectedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-4xl">{fileIcon(selectedFile.name)}</span>
                  <p className="font-semibold text-uncp-green text-sm break-all">{selectedFile.name}</p>
                  <p className="text-gray-400 text-xs">
                    {(selectedFile.size / 1024).toFixed(0)} KB — listo para subir
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <svg className="w-12 h-12 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="font-medium text-sm text-gray-600">Arrastra un archivo aquí</p>
                  <p className="text-xs">o haz clic para seleccionar</p>
                  <div className="flex gap-1.5 mt-1">
                    {ALLOWED_EXT.map(ext => (
                      <span key={ext} className="text-[11px] font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                        {ext}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Botones de acción */}
            {selectedFile && uploadStatus.type !== 'uploading' && (
              <div className="flex gap-2">
                <button
                  onClick={handleUpload}
                  className="flex-1 bg-uncp-green text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#145214] transition-colors shadow-sm"
                >
                  Subir e indexar
                </button>
                <button
                  onClick={() => { setFile(null); setStatus({ type: 'idle' }); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="px-4 rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Progreso */}
            {uploadStatus.type === 'uploading' && (
              <div className="flex items-center gap-3 bg-uncp-green/5 border border-uncp-green/20 rounded-xl px-4 py-3">
                <div className="flex gap-1 flex-shrink-0">
                  <div className="w-2 h-2 bg-uncp-green rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-uncp-green rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                  <div className="w-2 h-2 bg-uncp-green rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
                </div>
                <span className="text-uncp-green text-sm font-medium">
                  Generando embeddings e indexando en ChromaDB...
                </span>
              </div>
            )}

            {/* Éxito */}
            {uploadStatus.type === 'success' && (
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div className="flex-1 text-sm text-green-700">
                  <strong>{uploadStatus.file}</strong> indexado correctamente —{' '}
                  <strong>{uploadStatus.chunks}</strong> chunks generados.
                </div>
                <button onClick={() => setStatus({ type: 'idle' })} className="text-green-400 hover:text-green-600 flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Error */}
            {uploadStatus.type === 'error' && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="flex-1 text-sm text-red-700">{uploadStatus.message}</p>
                <button onClick={() => setStatus({ type: 'idle' })} className="text-red-400 hover:text-red-600 flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Lista de documentos ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <span className="text-lg">🗂️</span> Documentos indexados
              </h2>
              <p className="text-gray-400 text-xs mt-0.5">
                Base de conocimiento actual del chatbot
              </p>
            </div>
            {!loadingDocs && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full flex-shrink-0">
                {docs.length} docs · {totalChunks} chunks
              </span>
            )}
          </div>

          <div className="px-5 sm:px-6 py-4">
            {loadingDocs ? (
              <div className="flex justify-center py-8">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
                </div>
              </div>
            ) : docs.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium text-gray-500">Sin documentos aún</p>
                <p className="text-xs mt-1">Sube un documento para que el chatbot pueda responder consultas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {docs.map(doc => (
                  <DocRow
                    key={doc.file}
                    doc={doc}
                    isDeleting={deleting === doc.file}
                    isConfirming={confirmDelete === doc.file}
                    onConfirm={() => setConfirm(doc.file)}
                    onCancel={() => setConfirm(null)}
                    onDelete={() => handleDelete(doc.file)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

// ── Fila de documento ─────────────────────────────────────────────────────────

interface DocRowProps {
  doc: DocInfo
  isDeleting: boolean
  isConfirming: boolean
  onConfirm: () => void
  onCancel: () => void
  onDelete: () => void
}

function DocRow({ doc, isDeleting, isConfirming, onConfirm, onCancel, onDelete }: DocRowProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/80 transition-colors group">
      <span className="text-2xl flex-shrink-0">{fileIcon(doc.file)}</span>

      <div className="flex-1 min-w-0">
        <a
          href={`/files/${encodeURIComponent(doc.file)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Abrir ${doc.file}`}
          className="font-medium text-sm text-gray-800 truncate block hover:text-uncp-green hover:underline underline-offset-2 transition-colors"
        >
          {doc.file}
        </a>
        <p className="text-xs text-gray-400 mt-0.5">
          <span className="font-medium text-gray-500">{doc.chunks}</span> chunks
          {' · '}
          {formatDate(doc.ingested_at)}
        </p>
      </div>

      {/* Acciones */}
      {isConfirming ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-500 hidden sm:inline">¿Eliminar?</span>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
          >
            {isDeleting ? '…' : 'Sí'}
          </button>
          <button
            onClick={onCancel}
            className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={onConfirm}
          className="flex-shrink-0 text-xs text-gray-300 group-hover:text-gray-400 hover:!text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-all border border-transparent hover:border-red-200"
        >
          Eliminar
        </button>
      )}
    </div>
  )
}
