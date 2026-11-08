import { vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'

// Every invoke() in a test lands in `ipc` — the real IPC boundary, via Tauri's
// own mock of window.__TAURI_INTERNALS__, so tests assert the command and args
// that would reach Rust. Install ONCE per test file, before anything imports
// api/client.ts: each mockIPC() call replaces the event-listener table, which
// would drop client.ts's module-level `se-menu` listener. Reset `ipc`, never
// re-mock.
export const ipc = vi.fn<[cmd: string, args?: unknown], unknown>()

mockIPC((cmd, args) => ipc(cmd, args), { shouldMockEvents: true })

/** Answer `rpc(method)` calls from a table; anything else resolves to null. */
export function answerRpc(table: Record<string, unknown>): void {
  ipc.mockImplementation((cmd, args) => {
    const { method } = (args ?? {}) as { method?: string }
    if (cmd !== 'rpc' || !method || !(method in table)) return null
    const v = table[method]
    if (v instanceof Error) throw v.message // Tauri rejects with a plain string
    return v
  })
}
