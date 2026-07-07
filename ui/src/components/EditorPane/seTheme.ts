import { EditorView }                      from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags }                              from '@lezer/highlight'
import type { Extension }                    from '@codemirror/state'

// Compose an oklch() expression from a DaisyUI CSS variable, with optional alpha
const oc = (v: string, a?: number) =>
  a != null ? `oklch(var(${v}) / ${a})` : `oklch(var(${v}))`

export const seTheme: Extension = [
  EditorView.theme({
    '&': {
      color:           oc('--bc'),
      backgroundColor: oc('--b1'),
      height: '100%',
      fontSize: '13px',
    },
    '.cm-content': {
      caretColor: oc('--p'),
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: oc('--p'),
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: oc('--b3'),
    },
    '::selection': {
      backgroundColor: oc('--b3'),
    },
    '.cm-activeLine': {
      backgroundColor: oc('--b2', 0.7),
    },
    '.cm-gutters': {
      backgroundColor: oc('--b2'),
      color:           oc('--bc', 0.3),
      borderRight:     `1px solid ${oc('--b3')}`,
    },
    '.cm-activeLineGutter': {
      backgroundColor: oc('--b2'),
      color:           oc('--bc', 0.6),
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 4px',
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      overflow: 'auto',
    },
    '.cm-matchingBracket': {
      backgroundColor: oc('--p', 0.18),
      outline:         `1px solid ${oc('--p', 0.35)}`,
    },
    '.cm-tooltip': {
      backgroundColor: oc('--b2'),
      border:          `1px solid ${oc('--b3')}`,
      color:           oc('--bc'),
    },
    '.cm-foldPlaceholder': {
      backgroundColor: oc('--b3'),
      border:          'none',
      color:           oc('--bc', 0.6),
    },
  }),

  syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword,      color: oc('--p'),        fontWeight: '600'  },
    { tag: tags.string,       color: oc('--su')                           },
    { tag: tags.number,       color: oc('--wa')                           },
    { tag: tags.comment,      color: oc('--bc', 0.38), fontStyle: 'italic' },
    { tag: tags.variableName, color: oc('--bc', 0.82)                     },
    { tag: tags.operator,     color: oc('--a')                            },
    { tag: tags.punctuation,  color: oc('--bc', 0.45)                     },
    { tag: tags.literal,      color: oc('--wa')                           },
  ])),
]
