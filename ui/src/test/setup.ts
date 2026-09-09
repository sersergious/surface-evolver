import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

// jsdom doesn't implement scrollIntoView (OutputLog.tsx calls it on every update).
Element.prototype.scrollIntoView = vi.fn()

// jsdom has no real layout engine — CodeMirror measures text via Range
// geometry on every animation frame, which jsdom doesn't implement either.
const fakeRect = (): DOMRect => ({
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON: () => ({}),
})
Range.prototype.getClientRects = () => ({
  length: 0, item: () => null, [Symbol.iterator]: function* () {},
}) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = fakeRect
Element.prototype.getClientRects = () => ({
  length: 0, item: () => null, [Symbol.iterator]: function* () {},
}) as unknown as DOMRectList

// Safe default so any component tree that transitively imports api/client.ts
// (which calls `listen()` as a module-level side effect) doesn't crash
// outside a real Tauri webview. Test files that care about `invoke`/`listen`
// behavior directly (e.g. api/client.test.ts) declare their own more
// specific vi.mock, which takes precedence for that file.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
