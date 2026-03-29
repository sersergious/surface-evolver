import { useEffect, useRef } from 'react'
import { gh } from '../../theme'

interface Props {
  lines: string[]
}

export default function OutputLog({ lines }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div style={styles.log}>
      {lines.map((line, i) => {
        const isError = line.startsWith('[error]')
        const isPrompt = line.startsWith('>')
        const isJob = line.startsWith('[job') || line.startsWith('[ws]')
        const color = isError ? gh.error : isPrompt ? gh.accent : isJob ? gh.textMuted : gh.textSecondary
        return (
          <div key={i} style={{ ...styles.line, color }}>
            {line}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  log: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px',
    fontSize: 12,
    lineHeight: 1.6,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace',
    background: gh.bgInput,
  },
  line: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
}
