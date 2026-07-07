import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// All backend calls go through one Tauri command that dispatches on `method`
// (src-tauri/src/rpc.rs) — same shape as the old Electrobun RPC. No HTTP.
export function rpc<T>(method: string, params?: unknown): Promise<T> {
  return invoke<T>('rpc', { method, params: params ?? null }).catch((e) => {
    // Tauri rejects with a plain string; callers expect Error#message.
    throw e instanceof Error ? e : new Error(String(e))
  })
}

// Native menu clicks arrive as a Tauri event; re-dispatch as the
// CustomEvent('se-menu') that useMenuAction already listens for.
listen<string>('se-menu', (e) => {
  window.dispatchEvent(new CustomEvent('se-menu', { detail: e.payload }))
})
