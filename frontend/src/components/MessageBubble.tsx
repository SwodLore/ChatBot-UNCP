import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, Source } from '../hooks/useStreamingChat'

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

      {/* Avatar */}
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] sm:text-[10px] font-bold ${
          isUser ? 'bg-uncp-green text-white' : 'bg-uncp-dark text-uncp-gold'
        }`}
      >
        {isUser ? 'TÚ' : 'BOT'}
      </div>

      {/* Burbuja + fuentes */}
      <div className={`max-w-[85%] sm:max-w-[80%] flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-uncp-green text-white rounded-tr-none whitespace-pre-wrap'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'
          }`}
        >
          {/* Pensando... con puntos animados */}
          {!message.content && message.isStreaming ? (
            <div className="flex items-center gap-2 text-gray-400 py-0.5">
              <span className="text-sm">Pensando</span>
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
              </div>
            </div>
          ) : isUser ? (
            <>
              {message.content}
              {message.isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
              )}
            </>
          ) : (
            /* Mensajes del bot: renderizar markdown completo */
            <>
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
                {message.content}
              </ReactMarkdown>
              {message.isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
              )}
            </>
          )}
        </div>

        {/* Badges de fuente — clickeables para abrir el PDF */}
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1 sm:gap-1.5">
            {message.sources.slice(0, 3).map((src, i) => (
              <SourceBadge key={i} source={src} />
            ))}
          </div>
        )}
      </div>
    </div>
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
      <span className="truncate max-w-[120px] sm:max-w-none">{source.file}</span>
      <span className="flex-shrink-0">· p.{source.page} · {pct}%</span>
    </a>
  )
}
