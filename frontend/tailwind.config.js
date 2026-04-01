/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', '"Courier New"', 'monospace'],
      },
      colors: {
        'gh-bg-base':        'var(--gh-bg-base)',
        'gh-bg-surface':     'var(--gh-bg-surface)',
        'gh-bg-elevated':    'var(--gh-bg-elevated)',
        'gh-bg-input':       'var(--gh-bg-input)',
        'gh-border':         'var(--gh-border)',
        'gh-border-muted':   'var(--gh-border-muted)',
        'gh-text-primary':   'var(--gh-text-primary)',
        'gh-text-secondary': 'var(--gh-text-secondary)',
        'gh-text-muted':     'var(--gh-text-muted)',
        'gh-accent':         'var(--gh-accent)',
        'gh-accent-hover':   'var(--gh-accent-hover)',
        'gh-success':        'var(--gh-success)',
        'gh-error':          'var(--gh-error)',
        'gh-warning':        'var(--gh-warning)',
        'gh-btn-bg':         'var(--gh-btn-bg)',
        'gh-btn-border':     'var(--gh-btn-border)',
        'gh-btn-text':       'var(--gh-btn-text)',
        'gh-btn-hover-bg':   'var(--gh-btn-hover-bg)',
      },
    },
  },
  plugins: [],
}
