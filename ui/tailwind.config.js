const base = require('daisyui/src/theming/themes')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  plugins: [require('daisyui')],
  daisyui: {
    // The built-in light/dark themes, recoloured to a hue-free neutral. Kept
    // under their own names so App.tsx's OS-appearance switch is unchanged.
    // The only hues left in the chrome are the editor's numbers (warning) and
    // strings (success), muted; status colours keep their usual meaning.
    // Order matters: the first theme is the :root default, and `darkTheme`
    // takes over under prefers-color-scheme: dark — so no flash of the wrong
    // theme before App.tsx sets data-theme.
    themes: [
      {
        light: {
          ...base.light,
          'base-100': '#ffffff', 'base-200': '#fafafa', 'base-300': '#e5e5e5', 'base-content': '#0a0a0a',
          primary: '#0a0a0a', 'primary-content': '#fafafa',
          secondary: '#525252', accent: '#525252',
          neutral: '#171717', 'neutral-content': '#fafafa',
          success: '#3d6e3a', warning: '#8a5a0b',
          error: '#dc2626', info: '#525252',
          // Viewer facets and edges (OKLCH components, read by useThemeColors):
          // light facets with dark edges, the way SE's own display draws them.
          '--mesh': '82% 0 0', '--mesh-edge': '20.5% 0 0',
        },
      },
      {
        dark: {
          ...base.dark,
          'base-100': '#0a0a0a', 'base-200': '#111111', 'base-300': '#262626', 'base-content': '#fafafa',
          primary: '#fafafa', 'primary-content': '#0a0a0a',
          secondary: '#a3a3a3', accent: '#a3a3a3',
          neutral: '#262626', 'neutral-content': '#fafafa',
          success: '#9cc79a', warning: '#d9b77a',
          error: '#f87171', info: '#a3a3a3',
          '--mesh': '87% 0 0', '--mesh-edge': '14.5% 0 0',
        },
      },
    ],
    darkTheme: 'dark',
    logs: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', '"Courier New"', 'monospace'],
      },
    },
  },
}
