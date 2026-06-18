export interface SessionState {
  session_id:    string;
  fe_file:       string;
  energy:        number | null;
  area:          number | null;
  scale:         number | null;
  vertex_count:  number | null;
  edge_count:    number | null;
  facet_count:   number | null;
  last_accessed: Date;
}

const store = new Map<string, SessionState>();

function touch(s: SessionState): SessionState {
  s.last_accessed = new Date();
  return s;
}

export function get(sessionId: string): SessionState | undefined {
  const s = store.get(sessionId);
  return s ? touch(s) : undefined;
}

export function put(session: SessionState): void {
  store.set(session.session_id, session);
}

export function del(sessionId: string): boolean {
  return store.delete(sessionId);
}

export function exists(sessionId: string): boolean {
  return store.has(sessionId);
}

export function count(): number {
  return store.size;
}

export function all(): SessionState[] {
  return [...store.values()];
}
