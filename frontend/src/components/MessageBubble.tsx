import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, Source } from '../hooks/useStreamingChat'

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  // Usuario: burbuja verde alineada a la derecha, sin avatar (estilo ChatGPT)
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] bg-uncp-green text-white rounded-3xl rounded-br-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  // Asistente: sin burbuja — avatar + texto sobre el fondo, como ChatGPT
  return (
    <div className="flex gap-3 group">
      <div className="w-8 h-8 rounded-full flex-shrink-0 bg-uncp-dark overflow-hidden ring-1 ring-uncp-gold/40 mt-0.5">
        <img src="/uncp-logo.png" alt="UNCP" className="w-full h-full object-contain" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="text-sm leading-relaxed text-gray-800">
          {!message.content && message.isStreaming ? (
            <div className="flex items-center gap-2 text-gray-400 py-1.5">
              <span className="text-sm">Pensando</span>
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
              </div>
            </div>
          ) : (
            <>
              <MarkdownContent content={message.content} />
              {message.isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-uncp-green ml-0.5 animate-pulse align-middle" />
              )}
            </>
          )}
        </div>

        {/* Fuentes + acciones — aparecen cuando termina el streaming */}
        {!message.isStreaming && message.content && (
          <div className="flex flex-wrap items-center gap-1.5">
            {message.sources?.slice(0, 3).map((src, i) => (
              <SourceBadge key={i} source={src} />
            ))}
            <CopyButton text={message.content} />
          </div>
        )}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard no disponible (http sin localhost) */
    }
  }

  return (
    <button
      onClick={copy}
      title="Copiar respuesta"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs
        text-gray-400 hover:text-uncp-green hover:bg-gray-100 transition-colors
        opacity-0 group-hover:opacity-100 focus:opacity-100"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copiado
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copiar
        </>
      )}
    </button>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        /* Tablas */
        table: ({ ...props }) => (
          <div className="overflow-x-auto my-2 rounded-md border border-gray-200">
            <table className="min-w-full text-xs border-collapse" {...props} />
          </div>
        ),
        thead: ({ ...props }) => (
          <thead className="bg-uncp-dark text-white" {...props} />
        ),
        th: ({ ...props }) => (
          <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" {...props} />
        ),
        td: ({ ...props }) => (
          <td className="border-t border-gray-200 px-3 py-1.5 text-gray-700" {...props} />
        ),
        tr: ({ ...props }) => (
          <tr className="even:bg-gray-50 odd:bg-white" {...props} />
        ),
        tbody: ({ ...props }) => <tbody {...props} />,

        /* Texto */
        strong: ({ ...props }) => (
          <strong className="font-semibold text-gray-900" {...props} />
        ),
        em: ({ ...props }) => <em className="italic" {...props} />,
        p: ({ ...props }) => (
          <p className="mb-2 last:mb-0 leading-relaxed" {...props} />
        ),

        /* Listas */
        ul: ({ ...props }) => (
          <ul className="list-disc pl-4 space-y-1 my-1.5" {...props} />
        ),
        ol: ({ ...props }) => (
          <ol className="list-decimal pl-4 space-y-1 my-1.5" {...props} />
        ),
        li: ({ ...props }) => (
          <li className="leading-relaxed" {...props} />
        ),

        /* Cabeceras */
        h1: ({ ...props }) => (
          <h1 className="font-bold text-base mb-2 mt-3 first:mt-0 text-uncp-dark" {...props} />
        ),
        h2: ({ ...props }) => (
          <h2 className="font-bold text-sm mb-1.5 mt-2.5 first:mt-0 text-uncp-dark" {...props} />
        ),
        h3: ({ ...props }) => (
          <h3 className="font-semibold text-sm mb-1 mt-2 first:mt-0" {...props} />
        ),

        /* Código */
        code: ({ ...props }) => (
          <code className="bg-gray-100 rounded px-1 py-0.5 text-[11px] font-mono text-gray-700" {...props} />
        ),
        pre: ({ ...props }) => (
          <pre className="bg-gray-100 rounded-md p-3 overflow-x-auto text-[11px] font-mono text-gray-700 my-2" {...props} />
        ),

        /* Otros */
        blockquote: ({ ...props }) => (
          <blockquote className="border-l-4 border-uncp-green/40 pl-3 text-gray-600 italic my-2" {...props} />
        ),
        hr: () => <hr className="border-gray-200 my-3" />,
        a: ({ href, ...props }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-uncp-green underline underline-offset-2 hover:text-uncp-dark transition-colors"
            {...props}
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function SourceBadge({ source }: { source: Source }) {
  const pct = Math.round(source.score * 100)
  const color =
    source.score >= 0.7
      ? 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100'
      : source.score >= 0.5
        ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100'
        : 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100'

  const fileUrl = `/files/${encodeURIComponent(source.file)}`

  return (
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir ${source.file}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] sm:text-xs font-medium transition-colors cursor-pointer ${color}`}
    >
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <span className="truncate max-w-[140px] sm:max-w-[220px]">{source.file}</span>
      <span className="flex-shrink-0">· p.{source.page} · {pct}%</span>
    </a>
  )
}
