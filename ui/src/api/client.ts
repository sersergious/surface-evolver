import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '../store/useStore'

// Tauri rejects with a plain string; callers expect Error#message.
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

// All backend calls go through one Tauri command that dispatches on `method`
// (src-tauri/src/rpc.rs) — same shape as the old Electrobun RPC. No HTTP.
export function rpc<T>(method: string, params?: unknown): Promise<T> {
  return invoke<T>('rpc', { method, params: params ?? null }).catch((e) => {
    const err = toError(e)
    // No worker survived (failed reload, crash): the backend has already
    // dropped the session, so drop ours too, keeping the tab to reopen (#16).
    // The prefix is a signal between rpc.rs and here, not text for the user.
    if (err.message.startsWith(SESSION_ENDED)) {
      useStore.getState().clearSession()
      throw new Error(err.message.slice(SESSION_ENDED.length).trimStart())
    }
    throw err
  })
}

/** Must match SESSION_ENDED in src-tauri/src/rpc.rs. */
export const SESSION_ENDED = 'Session ended:'

// Native menu clicks arrive as a Tauri event; re-dispatch as the
// CustomEvent('se-menu') that useMenuAction already listens for.
listen<string>('se-menu', (e) => {
  window.dispatchEvent(new CustomEvent('se-menu', { detail: e.payload }))
})
