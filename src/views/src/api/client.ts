// @ts-ignore - electrobun/view is only resolvable inside the Electrobun webview bundle
import { Electroview } from 'electrobun/view'

// View-side RPC. View has no incoming handlers; all calls go to bun.
// maxRequestTime covers slow ops — a `g N` on a large mesh can run minutes.
const electroRpc = (Electroview as any).defineRPC({
  maxRequestTime: 300_000,
  handlers: { requests: {}, messages: {} },
})

const view = new (Electroview as any)({ rpc: electroRpc })

// Direct native IPC — method name is the bun-side handler (index.ts). No HTTP.
export function rpc<T>(method: string, params?: unknown): Promise<T> {
  return (view.rpc as any).request(method, params) as Promise<T>
}
