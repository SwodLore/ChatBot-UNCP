import { useRef, useEffect, useState } from 'react'
import { useStreamingChat } from '../hooks/useStreamingChat'
import { MessageBubble } from './MessageBubble'
import { SuggestedQuestions } from './SuggestedQuestions'
import { Sidebar } from './Sidebar'

const SUGGESTED = [
  '¿Cuándo inicia el semestre 2026-II?',
  '¿Cuáles son los requisitos para matrícula?',
  '¿Cómo solicito mi carné universitario?',
  '¿Cuál es el costo de constancia de estudios?',
]

export function ChatWindow() {
  const {
    messages,
    isLoading,
    sessionId,
    sendMessage,
    clearChat,
    loadSession,
    stopGeneration,
  } = useStreamingChat()

  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 768,
  )
  const [refreshKey, setRefreshKey] = useState(0)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Auto-scroll inteligente: solo sigue el streaming si el usuario está
  // cerca del final. Si subió a leer, no se le arrastra hacia abajo.
  const stickToBottom = useRef(true)

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Al terminar cada respuesta, refrescar la lista del sidebar
  useEffect(() => {
    if (!isLoading) setRefreshKey(k => k + 1)
  }, [isLoading])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  }, [input])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    stickToBottom.current = true
    sendMessage(text)
  }

  // Las sugerencias no pasan por handleSend: sin este guard, un doble clic
  // o un clic durante el streaming dispara dos peticiones simultáneas
  const handleSuggested = (q: string) => {
    if (isLoading) return
    stickToBottom.current = true
    sendMessage(q)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    /* h-dvh: usa la altura real del viewport en móvil (excluye barra del browser) */
    <div className="flex h-screen h-dvh w-full bg-white">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeSessionId={sessionId}
        onSelectSession={loadSession}
        onNewChat={clearChat}
        refreshKey={refreshKey}
      />

      {/* ── Columna principal ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header minimalista */}
        <header className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Abrir menú de conversaciones"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-sm text-gray-800 leading-tight truncate">
              Asistente Virtual UNCP
            </h1>
            <p className="text-[10px] text-gray-400 truncate">
              Universidad Nacional del Centro del Perú — Huancayo
            </p>
          </div>
        </header>

        {/* ── Mensajes ── */}
        <main
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-6 text-center px-4 max-w-2xl mx-auto">
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-uncp-dark rounded-full overflow-hidden ring-4 ring-uncp-gold/40 shadow-lg">
                <img src="/uncp-logo.png" alt="UNCP" className="w-full h-full object-contain" />
              </div>
              <div>
                <p className="text-gray-800 font-bold text-lg sm:text-2xl mb-1.5">
                  ¿En qué puedo ayudarte?
                </p>
                <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
                  Consulta sobre trámites, calendario académico, requisitos, costos y más
                </p>
              </div>
              <SuggestedQuestions questions={SUGGESTED} onSelect={handleSuggested} />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full px-3 sm:px-4 py-5 space-y-5">
              {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
              <div ref={bottomRef} />
            </div>
          )}
        </main>

        {/* ── Input flotante ── */}
        <footer className="flex-shrink-0 px-3 sm:px-4 pb-safe pb-3 pt-1">
          <div className="max-w-3xl mx-auto w-full">
            {messages.length > 0 && (
              <div className="mb-2">
                <SuggestedQuestions questions={SUGGESTED} onSelect={handleSuggested} compact />
              </div>
            )}
            <div className="flex items-end gap-2 rounded-3xl border border-gray-300 bg-white shadow-lg px-2 py-1.5
              focus-within:border-uncp-green focus-within:ring-2 focus-within:ring-uncp-green/20 transition-shadow">
              {/* text-base evita que iOS haga zoom al enfocar el input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Escribe tu consulta..."
                rows={1}
                className="flex-1 resize-none bg-transparent px-3 py-2.5 text-base sm:text-sm
                  focus:outline-none overflow-hidden placeholder:text-gray-400"
              />
              {isLoading ? (
                <button
                  onClick={stopGeneration}
                  title="Detener generación"
                  className="w-10 h-10 rounded-full bg-uncp-dark text-white flex items-center justify-center
                    flex-shrink-0 hover:bg-black transition-colors mb-0.5"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  title="Enviar"
                  className="w-10 h-10 rounded-full bg-uncp-green text-white flex items-center justify-center
                    flex-shrink-0 hover:bg-[#145214] disabled:opacity-30 disabled:cursor-not-allowed
                    transition-colors mb-0.5"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              )}
            </div>
            <p className="text-center text-[10px] text-gray-400 mt-2 px-4">
              El asistente puede cometer errores. Verifica la información importante en las oficinas de la UNCP.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
