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

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const sessionIdRef = useRef<string>(getOrCreateSessionId())

  // Al montar el componente, restaura los mensajes guardados en SQLite.
  // Esto permite que el estudiante haga F5 y retome la conversación.
  useEffect(() => {
    const sessionId = sessionIdRef.current
    fetch(`/api/sessions/${sessionId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.messages?.length > 0) {
          const restored: Message[] = data.messages.map(
            (m: { role: string; content: string }) => ({
              id: crypto.randomUUID(),
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }),
          )
          setMessages(restored)
        }
      })
      .catch(() => {}) // sesión nueva o backend no disponible: empieza vacío
  }, [])

  const sendMessage = useCallback(async (question: string) => {
    const sessionId = sessionIdRef.current

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

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, session_id: sessionId }),
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
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Error al conectar con el servidor: ${err}`, isStreaming: false }
            : m,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  const clearChat = useCallback(() => {
    setMessages([])
    // Nueva sesión: la conversación anterior queda guardada en SQLite
    // pero la UI empieza limpia y el próximo mensaje va a un session_id nuevo.
    const newId = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, newId)
    sessionIdRef.current = newId
  }, [])

  return { messages, isLoading, sendMessage, clearChat }
}
