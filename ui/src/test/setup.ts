import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
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

// Tauri IPC is faked once for the whole file by Tauri's own mockIPC (see
// ./ipc.ts). Must run before any test module imports api/client.ts.
import { ipc } from './ipc'
beforeEach(() => { ipc.mockReset().mockReturnValue(null) })
