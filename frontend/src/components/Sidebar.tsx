import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface SessionInfo {
  id: string
  created_at: string
  message_count: number
  last_message_at: string | null
  title: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewChat: () => void
  /** Cambia cuando termina un intercambio → recarga la lista */
  refreshKey: number
}

export function Sidebar({
  open,
  onClose,
  activeSessionId,
  onSelectSession,
  onNewChat,
  refreshKey,
}: Props) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])

  useEffect(() => {
    fetch('/api/sessions')
      .then(r => (r.ok ? r.json() : null))
      .then(data => setSessions(data?.sessions ?? []))
      .catch(() => setSessions([]))
  }, [refreshKey])

  return (
    <>
      {/* Overlay móvil: cierra el sidebar al tocar fuera */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 md:w-64 bg-uncp-dark text-white
          flex flex-col transition-transform duration-200 md:transition-none
          ${open ? 'translate-x-0' : '-translate-x-full md:hidden'}`}
      >
        {/* Cabecera con marca */}
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <div className="w-9 h-9 rounded-full bg-black/30 overflow-hidden ring-1 ring-uncp-gold/40 flex-shrink-0">
            <img src="/uncp-logo.png" alt="UNCP" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight truncate">Chatbot UNCP</p>
            <p className="text-[10px] text-white/50 truncate">Asistente de trámites</p>
          </div>
          {/* Cerrar (solo móvil) */}
          <button
            onClick={onClose}
            className="ml-auto md:hidden p-1.5 rounded-lg text-white/60 hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nueva conversación */}
        <div className="px-3 pb-2">
          <button
            onClick={() => {
              onNewChat()
              onClose()
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/20
              text-sm font-medium hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva conversación
          </button>
        </div>

        {/* Lista de conversaciones */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-white/40 text-xs px-3 py-2">Sin conversaciones aún</p>
          )}
          {sessions.map(s => {
            const isActive = s.id === activeSessionId
            return (
              <button
                key={s.id}
                onClick={() => {
                  onSelectSession(s.id)
                  onClose()
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors group
                  ${isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                <span className="block truncate">
                  {s.title || 'Conversación'}
                </span>
                <span className="block text-[10px] text-white/40 mt-0.5">
                  {s.message_count} mensajes
                </span>
              </button>
            )
          })}
        </nav>

        {/* Pie: enlace al panel admin */}
        <div className="px-3 py-3 border-t border-white/10">
          <Link
            to="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60
              hover:bg-white/10 hover:text-uncp-gold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Administrar documentos
          </Link>
        </div>
      </aside>
    </>
  )
}
