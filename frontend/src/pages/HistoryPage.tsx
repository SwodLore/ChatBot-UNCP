import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Session {
  id: string
  created_at: string
  message_count: number
}

interface HistoryMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatTime(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit',
  })
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase()
}

// ── Componente principal ──────────────────────────────────────────────────────

export function HistoryPage() {
  const [sessions, setSessions]       = useState<Session[]>([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState<Session | null>(null)
  const [messages, setMessages]       = useState<HistoryMessage[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [showDetail, setShowDetail]   = useState(false) // mobile: mostrar panel derecho
  const bottomRef = useRef<HTMLDivElement>(null)

  // Cargar lista de sesiones
  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  // Scroll al fondo cuando cambian los mensajes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cargar mensajes de una sesión
  const openSession = async (session: Session) => {
    setSelected(session)
    setShowDetail(true)
    setLoadingMsgs(true)
    setMessages([])
    try {
      const res  = await fetch(`/api/sessions/${session.id}`)
      const data = await res.json()
      setMessages(data.messages ?? [])
    } catch {
      setMessages([])
    } finally {
      setLoadingMsgs(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-uncp-green text-white px-4 sm:px-6 py-4 shadow-lg flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-uncp-dark rounded-full overflow-hidden ring-2 ring-uncp-gold/50 flex-shrink-0">
            <img src="/uncp-logo.png" alt="UNCP" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base sm:text-lg leading-tight">Historial de Conversaciones</h1>
            <p className="text-green-200 text-[10px] sm:text-xs">SQLite · últimas 50 sesiones</p>
          </div>
          <Link
            to="/admin"
            className="flex items-center gap-1.5 text-green-200 hover:text-uncp-gold text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="hidden sm:inline">Administración</span>
          </Link>
        </div>
      </header>

      {/* ── Cuerpo: dos paneles ── */}
      <div className="flex flex-1 max-w-6xl mx-auto w-full overflow-hidden" style={{ height: 'calc(100vh - 72px)' }}>

        {/* ── Panel izquierdo: lista de sesiones ── */}
        <aside
          className={`w-full sm:w-72 md:w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden
            ${showDetail ? 'hidden sm:flex' : 'flex'}`}
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Sesiones</span>
            {!loading && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {sessions.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="flex gap-1">
                  {[0, 160, 320].map(d => (
                    <div key={d} className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4 text-center">
                <svg className="w-10 h-10 mb-2 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm font-medium text-gray-500">Sin sesiones aún</p>
                <p className="text-xs mt-1">Las conversaciones aparecen aquí cuando los estudiantes usen el chatbot</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {sessions.map(s => (
                  <li key={s.id}>
                    <button
                      onClick={() => openSession(s)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex flex-col gap-0.5 ${
                        selected?.id === s.id ? 'bg-uncp-green/5 border-r-2 border-uncp-green' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-uncp-green">
                          #{shortId(s.id)}
                        </span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {formatDate(s.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        {s.message_count} {s.message_count === 1 ? 'mensaje' : 'mensajes'}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Panel derecho: conversación ── */}
        <section
          className={`flex-1 flex flex-col overflow-hidden bg-gray-50
            ${showDetail ? 'flex' : 'hidden sm:flex'}`}
        >
          {/* Sub-header del panel derecho */}
          {selected ? (
            <div className="px-4 sm:px-5 py-3 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
              {/* Botón volver (solo móvil) */}
              <button
                onClick={() => setShowDetail(false)}
                className="sm:hidden text-gray-500 hover:text-gray-700 p-1 -ml-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs font-bold text-uncp-green">#{shortId(selected.id)}</p>
                <p className="text-[10px] text-gray-400 truncate">
                  {selected.message_count} mensajes · {formatDate(selected.created_at)}
                </p>
              </div>
              <span className="text-[10px] text-gray-400 font-mono truncate hidden sm:block max-w-[200px]">
                {selected.id}
              </span>
            </div>
          ) : (
            <div className="px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
              <p className="text-sm text-gray-400">Selecciona una sesión para ver los mensajes</p>
            </div>
          )}

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-4">
            {loadingMsgs ? (
              <div className="flex justify-center py-10">
                <div className="flex gap-1">
                  {[0, 160, 320].map(d => (
                    <div key={d} className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            ) : !selected ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
                <svg className="w-14 h-14 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <div>
                  <p className="text-gray-500 font-medium text-sm">Sin sesión seleccionada</p>
                  <p className="text-gray-400 text-xs mt-1">Elige una sesión del panel izquierdo</p>
                </div>
              </div>
            ) : messages.length === 0 && !loadingMsgs ? (
              <div className="flex justify-center py-10 text-gray-400 text-sm">
                Esta sesión no tiene mensajes guardados
              </div>
            ) : (
              messages.map(msg => (
                <HistoryBubble key={msg.id} message={msg} />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </section>
      </div>
    </div>
  )
}

// ── Burbuja de historial (solo lectura, sin streaming) ────────────────────────

function HistoryBubble({ message }: { message: HistoryMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] sm:text-[10px] font-bold ${
          isUser ? 'bg-uncp-green text-white' : 'bg-uncp-dark text-uncp-gold'
        }`}
      >
        {isUser ? 'TÚ' : 'BOT'}
      </div>

      <div className={`max-w-[85%] sm:max-w-[78%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-3 sm:px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-uncp-green text-white rounded-tr-none whitespace-pre-wrap'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ ...props }) => (
                  <div className="overflow-x-auto my-2 rounded-md border border-gray-200">
                    <table className="min-w-full text-xs border-collapse" {...props} />
                  </div>
                ),
                thead: ({ ...props }) => <thead className="bg-uncp-dark text-white" {...props} />,
                th: ({ ...props }) => <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" {...props} />,
                td: ({ ...props }) => <td className="border-t border-gray-200 px-3 py-1.5 text-gray-700" {...props} />,
                tr: ({ ...props }) => <tr className="even:bg-gray-50 odd:bg-white" {...props} />,
                tbody: ({ ...props }) => <tbody {...props} />,
                strong: ({ ...props }) => <strong className="font-semibold text-gray-900" {...props} />,
                p: ({ ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                ul: ({ ...props }) => <ul className="list-disc pl-4 space-y-1 my-1.5" {...props} />,
                ol: ({ ...props }) => <ol className="list-decimal pl-4 space-y-1 my-1.5" {...props} />,
                li: ({ ...props }) => <li className="leading-relaxed" {...props} />,
                h1: ({ ...props }) => <h1 className="font-bold text-base mb-2 mt-3 first:mt-0 text-uncp-dark" {...props} />,
                h2: ({ ...props }) => <h2 className="font-bold text-sm mb-1.5 mt-2.5 first:mt-0 text-uncp-dark" {...props} />,
                h3: ({ ...props }) => <h3 className="font-semibold text-sm mb-1 mt-2 first:mt-0" {...props} />,
                code: ({ ...props }) => <code className="bg-gray-100 rounded px-1 py-0.5 text-[11px] font-mono text-gray-700" {...props} />,
                blockquote: ({ ...props }) => <blockquote className="border-l-4 border-uncp-green/40 pl-3 text-gray-600 italic my-2" {...props} />,
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
        <span className="text-[10px] text-gray-400 px-1">
          {formatTime(message.created_at)}
        </span>
      </div>
    </div>
  )
}
