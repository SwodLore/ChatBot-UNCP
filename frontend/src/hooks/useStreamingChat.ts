import { useState, useCallback, useEffect, useRef } from 'react'

export interface Source {
  file: string
  page: number
  score: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  isStreaming?: boolean
}

interface ServerMessage {
  role: string
  content: string
  sources?: Source[]
}

// sessionStorage: sobrevive F5 dentro de la misma pestaña, se borra al cerrarla.
// Cada pestaña tiene su propia sesión independiente.
const SESSION_KEY = 'uncp_chat_session'

function getOrCreateSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

function fromServer(messages: ServerMessage[]): Message[] {
  return messages.map(m => ({
    id: crypto.randomUUID(),
    role: m.role as 'user' | 'assistant',
    content: m.content,
    sources: m.sources, // persistidas en SQLite: sobreviven al F5
  }))
}

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>(getOrCreateSessionId)
  const sessionIdRef = useRef<string>(sessionId)
  const abortRef = useRef<AbortController | null>(null)

  // Al montar, restaura los mensajes de la sesión guardados en SQLite.
  // Esto permite que el estudiante haga F5 y retome la conversación.
  useEffect(() => {
    fetch(`/api/sessions/${sessionIdRef.current}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.messages?.length > 0) setMessages(fromServer(data.messages))
      })
      .catch(() => {}) // sesión nueva o backend no disponible: empieza vacío
  }, [])

  // Cambia a otra conversación existente (clic en el sidebar)
  const loadSession = useCallback(async (id: string) => {
    abortRef.current?.abort()
    sessionStorage.setItem(SESSION_KEY, id)
    sessionIdRef.current = id
    setSessionId(id)
    setIsLoading(false)
    try {
      const r = await fetch(`/api/sessions/${id}`)
      const data = r.ok ? await r.json() : null
      setMessages(data?.messages ? fromServer(data.messages) : [])
    } catch {
      setMessages([])
    }
  }, [])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const sendMessage = useCallback(async (question: string) => {
    const currentSessionId = sessionIdRef.current

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
    }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, session_id: currentSessionId }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'delta') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: m.content + event.content } : m,
                ),
              )
            } else if (event.type === 'sources') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, sources: event.sources } : m,
                ),
              )
            } else if (event.type === 'done') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m,
                ),
              )
            }
          } catch {
            // línea SSE mal formada, ignorar
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // El usuario detuvo la generación: conservar lo generado hasta ahora
        setMessages(prev =>
          prev.map(m => (m.id === assistantId ? { ...m, isStreaming: false } : m)),
        )
      } else {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: `Error al conectar con el servidor: ${err}`, isStreaming: false }
              : m,
          ),
        )
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
    }
  }, [])

  const clearChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    // Nueva sesión: la conversación anterior queda guardada en SQLite
    // pero la UI empieza limpia y el próximo mensaje va a un session_id nuevo.
    const newId = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, newId)
    sessionIdRef.current = newId
    setSessionId(newId)
  }, [])

  return { messages, isLoading, sessionId, sendMessage, clearChat, loadSession, stopGeneration }
}
