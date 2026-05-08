interface Props {
  questions: string[]
  onSelect: (q: string) => void
  compact?: boolean
}

export function SuggestedQuestions({ questions, onSelect, compact }: Props) {
  if (compact) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {questions.map(q => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            className="flex-shrink-0 text-xs bg-white border border-gray-300 text-gray-600 px-3 py-2 rounded-full hover:border-uncp-green hover:text-uncp-green transition-colors whitespace-nowrap min-h-[32px]"
          >
            {q}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {questions.map(q => (
        <button
          key={q}
          onClick={() => onSelect(q)}
          className="text-xs sm:text-sm bg-white border border-gray-300 text-gray-700 px-3 sm:px-4 py-2 rounded-xl hover:border-uncp-green hover:text-uncp-green hover:shadow-sm transition-all min-h-[40px]"
        >
          {q}
        </button>
      ))}
    </div>
  )
}
