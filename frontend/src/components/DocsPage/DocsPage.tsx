import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type Section = { label: string; file: string }
type Group = { title: string; sections: Section[] }

const NAV_GROUPS: Group[] = [
  {
    title: 'Getting Started',
    sections: [
      { label: 'Home', file: 'evolver.html' },
      { label: 'Overview', file: 'intro.html' },
      { label: 'Installation', file: 'install.html' },
      { label: 'Tutorial', file: 'tutorial.html' },
    ],
  },
  {
    title: 'Reference',
    sections: [
      { label: 'Geometric Elements', file: 'elements.html' },
      { label: 'Surface Models', file: 'model.html' },
      { label: 'Energies', file: 'energies.html' },
      { label: 'Constraints & Boundaries', file: 'constrnt.html' },
      { label: 'Named Quantities', file: 'quants.html' },
      { label: 'Data File Format', file: 'datafile.html' },
      { label: 'Commands', file: 'commands.html' },
      { label: 'Syntax', file: 'syntax.html' },
      { label: 'Graphics', file: 'graphics.html' },
      { label: 'Toggles', file: 'toggle.html' },
      { label: 'Scripts', file: 'scripts.html' },
    ],
  },
  {
    title: 'More',
    sections: [
      { label: 'Hints & Tips', file: 'hints.html' },
      { label: 'Debugging', file: 'debugging.html' },
      { label: 'Miscellaneous', file: 'misc.html' },
      { label: 'Bibliography', file: 'biblio.html' },
      { label: 'Full Index', file: 'index.html' },
    ],
  },
]

const ALL_SECTIONS = NAV_GROUPS.flatMap((g) => g.sections)

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
    </svg>
  )
}

export default function DocsPage() {
  const [activeFile, setActiveFile] = useState('evolver.html')
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const activeLabel = ALL_SECTIONS.find((s) => s.file === activeFile)?.label ?? ''

  const filtered = query.trim()
    ? ALL_SECTIONS.filter((s) => s.label.toLowerCase().includes(query.toLowerCase()))
    : null

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gh-bg-base font-sans">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="flex flex-col flex-none w-[240px] border-r border-gh-border bg-gh-bg-surface h-full overflow-hidden">

        {/* Logo / back row */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-gh-border">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-6 h-6 rounded text-gh-text-secondary hover:bg-gh-bg-elevated hover:text-gh-text-primary transition-colors"
            title="Back to app"
          >
            <ArrowLeftIcon />
          </button>
          <span className="text-[13px] font-semibold text-gh-text-primary tracking-tight">
            Surface Evolver
          </span>
          <span className="ml-auto text-[10px] font-medium text-gh-text-muted bg-gh-bg-elevated border border-gh-border rounded px-1.5 py-0.5 leading-none">
            v2.70
          </span>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b border-gh-border">
          <div className="flex items-center gap-2 bg-gh-bg-input border border-gh-border rounded-md px-2.5 py-1.5 focus-within:border-gh-accent transition-colors">
            <span className="text-gh-text-muted flex-none"><SearchIcon /></span>
            <input
              type="text"
              placeholder="Search docs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-[12px] text-gh-text-primary placeholder:text-gh-text-muted outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-gh-text-muted hover:text-gh-text-secondary text-[14px] leading-none"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="overflow-y-auto flex-1 py-2">
          {filtered ? (
            /* Search results */
            <ul className="list-none m-0 px-2">
              {filtered.length === 0 && (
                <li className="px-2 py-2 text-[12px] text-gh-text-muted">No results</li>
              )}
              {filtered.map(({ label, file }) => (
                <NavItem
                  key={file}
                  label={label}
                  file={file}
                  active={activeFile === file}
                  onClick={() => { setActiveFile(file); setQuery('') }}
                />
              ))}
            </ul>
          ) : (
            /* Grouped nav */
            NAV_GROUPS.map((group) => (
              <div key={group.title} className="mb-3">
                <div className="px-3 pb-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-gh-text-muted">
                  {group.title}
                </div>
                <ul className="list-none m-0 px-2">
                  {group.sections.map(({ label, file }) => (
                    <NavItem
                      key={file}
                      label={label}
                      file={file}
                      active={activeFile === file}
                      onClick={() => setActiveFile(file)}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 h-full overflow-hidden">

        {/* Topbar */}
        <div className="flex-none flex items-center gap-3 px-5 py-2.5 border-b border-gh-border bg-gh-bg-surface">
          {/* Breadcrumb */}
          <span className="text-[12px] text-gh-text-muted">Docs</span>
          {activeLabel && (
            <>
              <span className="text-[12px] text-gh-text-muted">/</span>
              <span className="text-[12px] font-medium text-gh-text-primary">{activeLabel}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <a
              href={`/docs/${activeFile}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-gh-text-muted hover:text-gh-accent transition-colors"
            >
              Open raw ↗
            </a>
          </div>
        </div>

        {/* Iframe */}
        <main className="flex-1 overflow-hidden">
          <iframe
            key={activeFile}
            src={`/docs/${activeFile}`}
            className="w-full h-full border-none"
            title={activeLabel}
          />
        </main>
      </div>
    </div>
  )
}

function NavItem({
  label,
  active,
  onClick,
}: {
  label: string
  file: string
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={[
          'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] cursor-pointer select-none transition-colors duration-100',
          active
            ? 'bg-gh-accent text-white font-medium'
            : 'text-gh-text-secondary hover:bg-gh-bg-elevated hover:text-gh-text-primary',
        ].join(' ')}
      >
        {label}
      </button>
    </li>
  )
}
