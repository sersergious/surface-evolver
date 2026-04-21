/** @type {import('tailwindcss').Config} */
const ch = (v) => `rgb(var(${v}) / <alpha-value>)`

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
        'gh-bg-base':        ch('--gh-bg-base'),
        'gh-bg-surface':     ch('--gh-bg-surface'),
        'gh-bg-elevated':    ch('--gh-bg-elevated'),
        'gh-bg-input':       ch('--gh-bg-input'),
        'gh-border':         ch('--gh-border'),
        'gh-border-muted':   ch('--gh-border-muted'),
        'gh-text-primary':   ch('--gh-text-primary'),
        'gh-text-secondary': ch('--gh-text-secondary'),
        'gh-text-muted':     ch('--gh-text-muted'),
        'gh-accent':         ch('--gh-accent'),
        'gh-accent-hover':   ch('--gh-accent-hover'),
        'gh-success':        ch('--gh-success'),
        'gh-error':          ch('--gh-error'),
        'gh-warning':        ch('--gh-warning'),
        'gh-btn-bg':         ch('--gh-btn-bg'),
        'gh-btn-border':     ch('--gh-btn-border'),
        'gh-btn-text':       ch('--gh-btn-text'),
        'gh-btn-hover-bg':   ch('--gh-btn-hover-bg'),
      },
    },
  },
  plugins: [],
}
