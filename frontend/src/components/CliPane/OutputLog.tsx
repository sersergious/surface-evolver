import { useEffect, useRef } from 'react'

interface Props {
  lines: string[]
}

export default function OutputLog({ lines }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed font-mono bg-gh-bg-input">
      {lines.map((line, i) => {
        const colorClass = line.startsWith('[error]')
          ? 'text-gh-error'
          : line.startsWith('>')
          ? 'text-gh-accent'
          : line.startsWith('[job') || line.startsWith('[ws]')
          ? 'text-gh-text-muted'
          : 'text-gh-text-secondary'
        return (
          <div key={i} className={`whitespace-pre-wrap break-all ${colorClass}`}>
            {line}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
