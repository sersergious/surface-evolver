import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMenuAction } from './useMenuAction'

function fireMenu(action: string) {
  window.dispatchEvent(new CustomEvent('se-menu', { detail: action }))
}

describe('useMenuAction', () => {
  it('invokes the handler with the action string from a se-menu event', () => {
    const handler = vi.fn()
    renderHook(() => useMenuAction(handler))
    fireMenu('run:refine')
    expect(handler).toHaveBeenCalledWith('run:refine')
  })

  it('ignores events with a non-string detail', () => {
    const handler = vi.fn()
    renderHook(() => useMenuAction(handler))
    window.dispatchEvent(new CustomEvent('se-menu', { detail: 42 }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('removes its listener on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useMenuAction(handler))
    unmount()
    fireMenu('run:refine')
    expect(handler).not.toHaveBeenCalled()
  })

  it('always calls the latest handler without re-binding the listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ h }) => useMenuAction(h), { initialProps: { h: first } })
    rerender({ h: second })
    fireMenu('run:pop')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('run:pop')
  })
})
