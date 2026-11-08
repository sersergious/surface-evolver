// @ts-check
// Lint only; no formatter, on purpose: a formatter would reformat the whole
// tree in one commit. CI runs `bun run lint`, which fails on warnings too.
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default defineConfig(
  { ignores: ['dist/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // The two classic hook rules. ponytail: the plugin's React Compiler
      // rules (refs, purity, set-state-in-effect, immutability) are off: this
      // app doesn't use the compiler, and they flag deliberate patterns such
      // as useMenuAction's latest-handler ref. Revisit with the React 19 move.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // `_name` marks a parameter a callback signature requires but we don't use.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
