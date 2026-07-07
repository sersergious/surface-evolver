import { useEffect, useRef } from 'react'

export default function OutputLog({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed font-mono bg-base-100">
      {lines.map((line, i) => {
        const cls = line.startsWith('[error]')
          ? 'text-error'
          : line.startsWith('>')
          ? 'text-primary'
          : line.startsWith('[job') || line.startsWith('[ws]')
          ? 'text-base-content/30'
          : 'text-base-content/80'
        return (
          <div key={i} className={`whitespace-pre-wrap break-all ${cls}`}>{line}</div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
