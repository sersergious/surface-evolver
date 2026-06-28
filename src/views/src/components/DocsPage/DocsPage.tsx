import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

type Section = { label: string; file: string }
type Group   = { title: string; sections: Section[] }

const NAV_GROUPS: Group[] = [
  {
    title: 'Getting Started',
    sections: [
      { label: 'Home',         file: 'evolver.htm'  },
      { label: 'Overview',     file: 'intro.htm'    },
      { label: 'Installation', file: 'install.htm'  },
      { label: 'Tutorial',     file: 'tutorial.htm' },
    ],
  },
  {
    title: 'Reference',
    sections: [
      { label: 'Geometric Elements',      file: 'elements.htm' },
      { label: 'Surface Models',          file: 'model.htm'    },
      { label: 'Energies',                file: 'energies.htm' },
      { label: 'Constraints & Boundaries',file: 'constrnt.htm' },
      { label: 'Named Quantities',        file: 'quants.htm'   },
      { label: 'Data File Format',        file: 'datafile.htm' },
      { label: 'Commands',                file: 'commands.htm' },
      { label: 'Syntax',                  file: 'syntax.htm'   },
      { label: 'Graphics',                file: 'graphics.htm' },
      { label: 'Toggles',                 file: 'toggle.htm'   },
      { label: 'Scripts',                 file: 'scripts.htm'  },
    ],
  },
  {
    title: 'More',
    sections: [
      { label: 'Hints & Tips',  file: 'hints.htm'     },
      { label: 'Debugging',     file: 'debugging.htm' },
      { label: 'Miscellaneous', file: 'misc.htm'      },
      { label: 'Bibliography',  file: 'biblio.htm'    },
      { label: 'Full Index',    file: 'index.htm'     },
    ],
  },
]

const ALL_SECTIONS = NAV_GROUPS.flatMap(g => g.sections)

// Reads a CSS variable from the host document (DaisyUI channel values, e.g. "0.2 0.05 240")
function readVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function buildIframeCSS() {
  // Copy DaisyUI OKLCH channel variables into the iframe's :root so oklch(var(--b1)) etc. resolve
  const vars = ['--b1','--b2','--b3','--bc','--p','--a','--su','--wa','--er','--n']
    .map(n => `  ${n}: ${readVar(n)};`)
    .join('\n')

  return `
:root {
${vars}
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  background-color: oklch(var(--b1)) !important;
  color: oklch(var(--bc)) !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif !important;
  font-size: 14px !important;
  line-height: 1.65 !important;
  margin: 0;
  padding: 0 !important;
}
body { padding: 24px 32px !important; max-width: 860px; margin: 0 auto; }
a             { color: oklch(var(--p)); text-decoration: none; }
a:hover       { text-decoration: underline; opacity: 0.85; }
h1,h2,h3,h4,h5,h6 {
  color: oklch(var(--bc));
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.4em;
}
h1 { font-size: 1.6em;  border-bottom: 1px solid oklch(var(--b3)); padding-bottom: 0.3em; }
h2 { font-size: 1.25em; border-bottom: 1px solid oklch(var(--b3)); padding-bottom: 0.2em; }
h3 { font-size: 1.05em; }
p  { margin: 0.6em 0; }
pre {
  background: oklch(var(--b2)) !important;
  color: oklch(var(--bc)) !important;
  border: 1px solid oklch(var(--b3));
  border-radius: 6px;
  padding: 12px 16px !important;
  overflow-x: auto;
  font-size: 12.5px !important;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace !important;
  line-height: 1.5 !important;
}
code, tt {
  background: oklch(var(--b2)) !important;
  color: oklch(var(--bc) / 0.9) !important;
  border: 1px solid oklch(var(--b3));
  border-radius: 3px;
  padding: 0.1em 0.35em;
  font-size: 0.88em !important;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace !important;
}
pre code, pre tt { background: none !important; border: none !important; padding: 0 !important; font-size: inherit !important; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 13px;
}
th, td {
  border: 1px solid oklch(var(--b3));
  padding: 6px 12px;
  text-align: left;
  vertical-align: top;
}
th {
  background: oklch(var(--b2));
  color: oklch(var(--bc));
  font-weight: 600;
}
tr:nth-child(even) td { background: oklch(var(--b2) / 0.4); }
hr  { border: none; border-top: 1px solid oklch(var(--b3)); margin: 1.5em 0; }
blockquote {
  border-left: 3px solid oklch(var(--b3));
  margin: 0.8em 0;
  padding: 0.4em 1em;
  color: oklch(var(--bc) / 0.7);
}
dl dt { font-weight: 600; margin-top: 0.8em; }
dl dd { margin-left: 1.5em; color: oklch(var(--bc) / 0.85); }
ul, ol { padding-left: 1.5em; }
li { margin: 0.2em 0; }
::-webkit-scrollbar       { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: oklch(var(--bc) / 0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: oklch(var(--bc) / 0.3); }
`
}

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
  const [activeFile, setActiveFile] = useState('evolver.htm')
  const [query,      setQuery]      = useState('')
  const navigate = useNavigate()

  const activeLabel = ALL_SECTIONS.find(s => s.file === activeFile)?.label ?? ''

  const filtered = query.trim()
    ? ALL_SECTIONS.filter(s => s.label.toLowerCase().includes(query.toLowerCase()))
    : null

  const injectStyles = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = (e.currentTarget as HTMLIFrameElement).contentDocument
      if (!doc?.head) return

      // Remove previous injected style if any
      doc.getElementById('se-theme-override')?.remove()

      const style = doc.createElement('style')
      style.id = 'se-theme-override'
      style.textContent = buildIframeCSS()
      doc.head.appendChild(style)

      // Sync active nav item if the user clicked a link inside the iframe
      const pathname = (e.currentTarget as HTMLIFrameElement).contentWindow?.location.pathname ?? ''
      const file = pathname.split('/').pop()
      if (file && ALL_SECTIONS.some(s => s.file === file)) setActiveFile(file)
    } catch {
      // cross-origin guard
    }
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-100 font-sans">

      {/* ── Sidebar ── */}
      <aside className="flex flex-col flex-none w-60 bg-base-200 h-full overflow-hidden">

        {/* Top row — matches main app navbar height and traffic-light padding */}
        <div className="flex items-center gap-2 px-3 h-11 shrink-0 border-b border-base-300 drag-region pl-[72px]">
          <button
            onClick={() => navigate('/')}
            className="no-drag btn btn-ghost btn-xs btn-square"
            title="Back to app"
          >
            <ArrowLeftIcon />
          </button>
          <span className="text-sm font-semibold text-base-content whitespace-nowrap select-none">
            Docs
          </span>
          <span className="ml-auto badge badge-ghost badge-sm font-mono text-[10px]">v2.70</span>
        </div>

        {/* Search */}
        <div className="px-3 py-2 shrink-0 border-b border-base-300">
          <label className="input input-sm flex items-center gap-2 bg-base-100 border-base-300">
            <span className="text-base-content/40"><SearchIcon /></span>
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="grow bg-transparent outline-none text-xs placeholder:text-base-content/30"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-base-content/40 hover:text-base-content text-sm leading-none">×</button>
            )}
          </label>
        </div>

        {/* Nav */}
        <nav className="overflow-y-auto flex-1 py-2">
          {filtered ? (
            <ul className="menu menu-sm px-2">
              {filtered.length === 0 && (
                <li className="px-2 py-2 text-xs text-base-content/40">No results</li>
              )}
              {filtered.map(({ label, file }) => (
                <NavItem key={file} label={label} file={file} active={activeFile === file}
                  onClick={() => { setActiveFile(file); setQuery('') }} />
              ))}
            </ul>
          ) : (
            NAV_GROUPS.map(group => (
              <div key={group.title} className="mb-2">
                <div className="px-4 py-1 text-[10px] font-semibold tracking-widest uppercase text-base-content/40">
                  {group.title}
                </div>
                <ul className="menu menu-sm px-2">
                  {group.sections.map(({ label, file }) => (
                    <NavItem key={file} label={label} file={file} active={activeFile === file}
                      onClick={() => setActiveFile(file)} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>

      {/* Sidebar drag line */}
      <div className="w-px shrink-0 h-full bg-base-300" />

      {/* ── Main content ── */}
      <div className="flex flex-col flex-1 h-full overflow-hidden">

        {/* Breadcrumb bar — same height as navbar */}
        <div className="flex-none flex items-center gap-2 px-4 h-11 border-b border-base-300 bg-base-200 drag-region">
          <span className="text-xs text-base-content/40 select-none">Docs</span>
          {activeLabel && (
            <>
              <span className="text-xs text-base-content/25 select-none">/</span>
              <span className="text-xs font-medium text-base-content select-none">{activeLabel}</span>
            </>
          )}
        </div>

        {/* Iframe */}
        <main className="flex-1 overflow-hidden">
          <iframe
            key={activeFile}
            src={`/docs/${activeFile}`}
            className="w-full h-full border-none"
            title={activeLabel}
            onLoad={injectStyles}
          />
        </main>
      </div>
    </div>
  )
}

function NavItem({ label, active, onClick }: { label: string; file: string; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={active ? 'active text-primary-content' : 'text-base-content/70'}
      >
        {label}
      </button>
    </li>
  )
}
