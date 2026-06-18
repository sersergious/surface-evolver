/**
 * SE subprocess manager.
 *
 * Each loadSession() kills the previous worker and spawns a fresh Bun
 * subprocess that owns exactly one libse.so instance, preventing the
 * double-init heap corruption that occurs when startup() is called twice.
 *
 * The Mutex serialises all blocking subprocess I/O so the event loop
 * stays free for status-check requests. isBusy() returns true while
 * any operation holds the lock, so callers can return 409 Conflict.
 */

import { join } from "path";

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

  /** Yield every line (progress + result) until the result. EOF = cancellation. */
  async *streamUntilResult(): AsyncGenerator<WorkerMsg> {
    while (true) {
      const { value, done } = await this.lineGen.next();
      if (done) return;                          // worker killed = cancelled
      const msg = JSON.parse(value!) as WorkerMsg;
      yield msg;
      if (msg.type === "result") return;
    }
  }

  kill(): void {
    try { this.proc.kill(); } catch { /* already dead */ }
  }
}

// ── module state ──────────────────────────────────────────────────────────────

const WORKER_SCRIPT = join(import.meta.dir, "se-worker.ts");

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
  return (worker = new WorkerHandle(proc));
}

function checkResult(msg: WorkerMsg): void {
  if (msg.ok) return;
  const text = msg.se_error ?? msg.error ?? "SE worker returned an error";
  const err  = new Error(text) as Error & { isSEError: boolean };
  err.isSEError = !!msg.se_error;
  throw err;
}

// ── public API ────────────────────────────────────────────────────────────────

export function isBusy(): boolean { return mutex.locked; }

export async function loadSession(sessionId: string, fePath: string): Promise<{
  energy: number; area: number; scale: number;
  vertex_count: number; edge_count: number; facet_count: number;
}> {
  await mutex.acquire();
  try {
    activeSessionId = sessionId;
    const w = spawnWorker();
    await w.send({ cmd: "load", path: fePath });
    const msg = await w.recvResult();
    checkResult(msg);
    return msg as ReturnType<typeof loadSession> extends Promise<infer R> ? R : never;
  } finally {
    mutex.release();
  }
}

export async function runCommand(
  sessionId: string, command: string,
): Promise<{ output: string; energy: number; area: number }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "run", command });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as { output: string; energy: number; area: number };
  } finally {
    mutex.release();
  }
}

export async function getMesh(sessionId: string): Promise<{
  vertices: number[][]; vertex_ids: number[]; facets: number[][];
  body_volumes: Record<string, number>;
}> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);
    await worker.send({ cmd: "mesh" });
    const msg = await worker.recvResult();
    checkResult(msg);
    return msg as ReturnType<typeof getMesh> extends Promise<infer R> ? R : never;
  } finally {
    mutex.release();
  }
}

export async function iterateAsync(
  sessionId: string,
  steps: number,
  progressCb: (step: number, total: number, energy: number) => Promise<void>,
): Promise<{ steps_completed: number; energy_start: number | null; energy_end: number | null }> {
  await mutex.acquire();
  try {
    if (activeSessionId !== sessionId)
      throw new Error(`Session ${sessionId} is not currently loaded (active: ${activeSessionId})`);
    if (!worker) throw new Error(`No active SE worker for session ${sessionId}`);

    await worker.send({ cmd: "iterate", steps });

    let energyStart: number | null = null;
    let stepsDone = 0;

    for await (const msg of worker.streamUntilResult()) {
      if (msg.type === "progress") {
        if (energyStart === null) energyStart = msg.energy ?? null;
        stepsDone = msg.step ?? stepsDone;
        await progressCb(msg.step!, msg.total!, msg.energy!);
      } else if (msg.type === "result") {
        checkResult(msg);
        return {
          steps_completed: (msg.steps_completed as number | undefined) ?? stepsDone,
          energy_start:    (msg.energy_start    as number | undefined) ?? energyStart,
          energy_end:      (msg.energy_end      as number | null | undefined) ?? null,
        };
      }
    }

    // Stream ended without a result = worker was killed (cancellation).
    return { steps_completed: stepsDone, energy_start: energyStart, energy_end: null };
  } finally {
    mutex.release();
  }
}

export function clearSession(sessionId: string): void {
  if (activeSessionId === sessionId) {
    activeSessionId = null;
    if (worker) { worker.kill(); worker = null; }
  }
}

export function cancelCurrent(): void {
  if (worker) { worker.kill(); }
  // Don't null worker here; iterateAsync will see stream EOF and return.
}
