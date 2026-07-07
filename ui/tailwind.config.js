/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  plugins: [require('daisyui')],
  daisyui: {
    // Only the two built-in daisyUI themes; the app follows the OS appearance.
    themes: ['light', 'dark'],
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
