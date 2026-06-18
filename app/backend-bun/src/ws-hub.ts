import type { ServerWebSocket } from "bun";

type AppWS = ServerWebSocket<{ sessionId: string }>;

const connections = new Map<string, Set<AppWS>>();

export function register(sessionId: string, ws: AppWS): void {
  if (!connections.has(sessionId)) connections.set(sessionId, new Set());
  connections.get(sessionId)!.add(ws);
}

export function unregister(sessionId: string, ws: AppWS): void {
  connections.get(sessionId)?.delete(ws);
}

export function broadcast(sessionId: string, msg: object): void {
  const payload = JSON.stringify(msg);
  for (const ws of connections.get(sessionId) ?? []) {
    try { ws.send(payload); }
    catch { connections.get(sessionId)?.delete(ws); }
  }
}
