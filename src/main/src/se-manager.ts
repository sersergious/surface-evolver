/**
 * SE subprocess manager.
 *
 * Each loadSession() kills the previous worker and spawns a fresh Bun
 * subprocess that owns exactly one libse.so instance, preventing the
 * double-init heap corruption that occurs when startup() is called twice.
 *
 * The Mutex serialises all blocking subprocess I/O so concurrent RPC
 * calls can't interleave on the single worker.
 */

import { config } from "./config";

// ── Mutex ─────────────────────────────────────────────────────────────────────

class Mutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this._locked) { this._locked = true; return; }
    return new Promise(resolve => this._queue.push(resolve));
  }

  release(): void {
    const next = this._queue.shift();
    if (next) { next(); } else { this._locked = false; }
  }

  get locked(): boolean { return this._locked; }
}

// ── line reader ───────────────────────────────────────────────────────────────

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader  = stream.getReader();
  const decoder = new TextDecoder();
  let   buf     = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const t = buf.trim();
        if (t) yield t;
        return;
      }
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield line;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── WorkerHandle ──────────────────────────────────────────────────────────────

interface WorkerMsg {
  type:            "result" | "progress" | "fatal";
  ok?:             boolean;
  se_error?:       string;
  error?:          string;
  step?:           number;
  total?:          number;
  energy?:         number;
  steps_completed?: number;
  energy_start?:   number;
  energy_end?:     number | null;
  [k: string]:     unknown;
}

class WorkerHandle {
  readonly proc: ReturnType<typeof Bun.spawn>;
  private lineGen: AsyncGenerator<string>;

  constructor(proc: ReturnType<typeof Bun.spawn>) {
    this.proc    = proc;
    this.lineGen = readLines(proc.stdout as ReadableStream<Uint8Array>);
  }

  async send(msg: object): Promise<void> {
    const data = Buffer.from(JSON.stringify(msg) + "\n");
    (this.proc.stdin as import("bun").FileSink).write(data);
    (this.proc.stdin as import("bun").FileSink).flush();
  }

  /** Read lines until a {type:"result"} line arrives. */
  async recvResult(): Promise<WorkerMsg> {
    while (true) {
      const { value, done } = await this.lineGen.next();
      if (done) throw new Error("SE worker process terminated unexpectedly");
      const msg = JSON.parse(value!) as WorkerMsg;
      if (msg.type === "result") return msg;
    }
  }

  kill(): void {
    try { this.proc.kill(); } catch { /* already dead */ }
  }
}

// ── module state ──────────────────────────────────────────────────────────────

const WORKER_SCRIPT = config.seWorkerPath;

const mutex                            = new Mutex();
let   worker:          WorkerHandle | null = null;
let   activeSessionId: string  | null = null;

// ── helpers ───────────────────────────────────────────────────────────────────

function spawnWorker(): WorkerHandle {
  if (worker) {
    worker.kill();
    worker = null;
  }
  const proc = Bun.spawn([process.execPath, "run", WORKER_SCRIPT], {
    stdin:  "pipe",
    stdout: "pipe",
    stderr: "inherit",   // worker's debug output surfaces in server logs
    env:    process.env,
  });
  const handle = new WorkerHandle(proc);
  // When this proc dies (crash / OOM / our own kill), drop module state so the
  // next RPC gets a clean "not loaded" the frontend handles, instead of a hung
  // send() to dead stdin. The in-flight recvResult() still rejects on its own.
  proc.exited.then(() => {
    if (worker === handle) { worker = null; activeSessionId = null; }
  });
  return (worker = handle);
}

function checkResult(msg: WorkerMsg): void {
  if (msg.ok) return;
  const text = msg.se_error ?? msg.error ?? "SE worker returned an error";
  const err  = new Error(text) as Error & { isSEError: boolean };
  err.isSEError = !!msg.se_error;
  throw err;
}

// ── public API ────────────────────────────────────────────────────────────────

export async function loadSession(sessionId: string, fePath: string): Promise<{
  energy: number; area: number; scale: number; sdim: number;
  vertex_count: number; edge_count: number; facet_count: number;
  lagrange_order: number; bbox_min: number[] | null; bbox_max: number[] | null;
  total_time: number;
}> {
  await mutex.acquire();
  try {
    activeSessionId = sessionId;
    const w = spawnWorker();
    await w.send({ cmd: "load", path: fePath });
    const msg = await w.recvResult();
    checkResult(msg);
    return msg as unknown as ReturnType<typeof loadSession> extends Promise<infer R> ? R : never;
  } finally {
    mutex.release();
  }
}

export async function runCommand(
  sessionId: string, command: string,
): Promise<{ output: string; energy: number; area: number; total_time: number }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "run", command });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as { output: string; energy: number; area: number; total_time: number };
  } finally {
    mutex.release();
  }
}

export async function getQuantities(sessionId: string): Promise<{
  quantities: { name: string; value: number; target: number; modulus: number; flags: number }[];
  methods: { name: string; type: number; value: number }[];
}> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "quantities" });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as ReturnType<typeof getQuantities> extends Promise<infer R> ? R : never;
  } finally {
    mutex.release();
  }
}

export interface MeshParams { min_area: number; min_length: number; max_len: number; temperature: number }
export interface Physics { gravflag: boolean; grav_const: number; pressflag: boolean; pressure: number }
export interface Settings { mesh_params: MeshParams; physics: Physics; total_time: number }

export async function getSettings(sessionId: string): Promise<Settings> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "settings" });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as Settings;
  } finally {
    mutex.release();
  }
}

export async function setSettings(
  sessionId: string, patch: { mesh_params?: MeshParams; physics?: Physics },
): Promise<Settings & { energy: number; area: number }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "set_settings", ...patch });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as Settings & { energy: number; area: number };
  } finally {
    mutex.release();
  }
}

export async function getVertexInfo(sessionId: string, vpos: number): Promise<{
  id: number; xyz: number[]; attr: number; constraints: { idx: number; name: string }[];
}> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "vertex_info", vpos });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as ReturnType<typeof getVertexInfo> extends Promise<infer R> ? R : never;
  } finally {
    mutex.release();
  }
}

export async function runTopo(
  sessionId: string, op: string, n?: number,
): Promise<{ output: string; counts: Record<string, number>; energy: number; energy_delta: number; area: number; total_time: number }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "topo", op, ...(typeof n === "number" ? { n } : {}) });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as { output: string; counts: Record<string, number>; energy: number; energy_delta: number; area: number; total_time: number };
  } finally {
    mutex.release();
  }
}

export async function getMesh(sessionId: string, colors?: boolean): Promise<{
  vertices: number[][]; vertex_ids: number[]; facets: number[][]; edges: number[][];
  body_volumes: Record<string, number>; body_pressures: Record<string, number>;
  facet_colors?: number[]; edge_colors?: number[];
}> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "mesh", ...(colors ? { colors: true } : {}) });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as ReturnType<typeof getMesh> extends Promise<infer R> ? R : never;
  } finally {
    mutex.release();
  }
}

export async function setScale(
  sessionId: string, scale: number,
): Promise<{ scale: number; energy: number; area: number }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "set_scale", scale });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as unknown as { scale: number; energy: number; area: number };
  } finally {
    mutex.release();
  }
}

export async function dump(sessionId: string): Promise<{ content: string }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "dump" });
    const msg = await worker.recvResult();
    checkResult(msg);
    return { content: msg.content as string };
  } finally {
    mutex.release();
  }
}

