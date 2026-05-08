import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStreamingChat } from '../hooks/useStreamingChat'
import { MessageBubble } from './MessageBubble'
import { SuggestedQuestions } from './SuggestedQuestions'

const SUGGESTED = [
  '¿Cuándo inicia el semestre 2026-II?',
  '¿Cuáles son los requisitos para matrícula?',
  '¿Cómo solicito mi carné universitario?',
  '¿Cuál es el costo de constancia de estudios?',
]

export function ChatWindow() {
  const { messages, isLoading, sendMessage, clearChat } = useStreamingChat()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    sendMessage(text)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    /* h-dvh: usa la altura real del viewport en móvil (excluye barra del browser) */
    <div className="flex flex-col h-screen h-dvh max-w-3xl mx-auto w-full">

      {/* ── Header ── */}
      <header className="bg-uncp-green text-white px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 shadow-lg flex-shrink-0">
        {/* Logo — fondo oscuro para que el anillo del escudo no flote */}
        <div className="w-11 h-11 sm:w-12 sm:h-12 flex-shrink-0 bg-uncp-dark rounded-full overflow-hidden ring-2 ring-uncp-gold/50">
          <img
            src="/uncp-logo.png"
            alt="Escudo UNCP"
            className="w-full h-full object-contain"
          />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-sm sm:text-lg leading-tight">
            Asistente Virtual UNCP
          </h1>
          <p className="text-green-200 text-[10px] sm:text-xs truncate">
            Universidad Nacional del Centro del Perú — Huancayo
          </p>
        </div>

        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-green-200 hover:text-uncp-gold text-xs sm:text-sm px-2 sm:px-3 py-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 min-h-[36px]"
          >
            Limpiar
          </button>
        )}
        {/* Enlace al panel de administración */}
        <Link
          to="/admin"
          title="Administrar documentos"
          className="text-green-200 hover:text-uncp-gold transition-colors flex-shrink-0 p-1.5 rounded-lg hover:bg-white/10"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </header>

      {/* ── Mensajes ── */}
      <main className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 sm:gap-6 text-center px-2 sm:px-4">
            {/* Escudo grande en pantalla de bienvenida */}
            <div className="w-24 h-24 sm:w-28 sm:h-28 bg-uncp-dark rounded-full overflow-hidden ring-4 ring-uncp-gold/40 shadow-lg">
              <img
                src="/uncp-logo.png"
                alt="UNCP"
                className="w-full h-full object-contain"
              />
            </div>

            <div>
              <p className="text-gray-800 font-bold text-base sm:text-xl mb-1">
                ¿En qué puedo ayudarte?
              </p>
              <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
                Consulta sobre trámites, calendario académico,<br className="hidden sm:block" />
                requisitos, costos y más
              </p>
            </div>

            <SuggestedQuestions questions={SUGGESTED} onSelect={sendMessage} />
          </div>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={bottomRef} />
      </main>

      {/* ── Input ── */}
      <footer className="px-3 sm:px-4 pb-safe pb-4 pt-2 sm:pt-3 bg-white border-t border-gray-200 flex-shrink-0">
        {messages.length > 0 && (
          <div className="mb-2">
            <SuggestedQuestions questions={SUGGESTED} onSelect={sendMessage} compact />
          </div>
        )}
        <div className="flex gap-2 items-end">
          {/* text-base evita que iOS haga zoom al enfocar el input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Escribe tu consulta... (Enter para enviar)"
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 sm:px-4 py-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-uncp-green/30 focus:border-uncp-green bg-white shadow-sm disabled:bg-gray-50 disabled:text-gray-400 overflow-hidden"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="w-11 h-11 rounded-xl bg-uncp-green text-white flex items-center justify-center flex-shrink-0 hover:bg-[#145214] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  )
}
