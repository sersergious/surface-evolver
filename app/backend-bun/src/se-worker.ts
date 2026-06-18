/**
 * SE worker subprocess.
 * Spawned once per session by se-manager.ts. Owns one libse.so instance.
 *
 * Protocol: line-delimited JSON on stdin/stdout.
 *   stdin  ← {"cmd":"load"|"run"|"mesh"|"iterate", ...}
 *   stdout → {"type":"result","ok":true|false, ...}
 *             {"type":"progress","step":N,"total":M,"energy":E}  (iterate only)
 *
 * Cancellation: manager kills the process (SIGTERM/SIGKILL). No in-band cancel cmd.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import * as readline from "readline";

// ── library load ─────────────────────────────────────────────────────────────

const SE_LIB_PATH = process.env.SE_LIB_PATH ?? "/app/libse.so";

let lib: ReturnType<typeof dlopen<typeof SYMBOLS>>["symbols"];

const SYMBOLS = {
  se_init:             { returns: FFIType.int,     args: [] },
  se_load:             { returns: FFIType.int,     args: [FFIType.ptr] },
  se_run:              { returns: FFIType.int,     args: [FFIType.ptr] },
  se_get_energy:       { returns: FFIType.double,  args: [] },
  se_get_area:         { returns: FFIType.double,  args: [] },
  se_get_scale:        { returns: FFIType.double,  args: [] },
  se_get_vertex_count: { returns: FFIType.int,     args: [] },
  se_get_edge_count:   { returns: FFIType.int,     args: [] },
  se_get_facet_count:  { returns: FFIType.int,     args: [] },
  se_get_body_count:   { returns: FFIType.int,     args: [] },
  se_get_vertices:     { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_ids:   { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_facets:       { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_body_volumes: { returns: FFIType.int,     args: [FFIType.ptr, FFIType.ptr, FFIType.int] },
  se_pop_output:       { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_pop_errout:       { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_last_error:       { returns: FFIType.cstring, args: [] },
} as const;

try {
  lib = dlopen(SE_LIB_PATH, SYMBOLS).symbols;
} catch (e) {
  process.stdout.write(JSON.stringify({ type: "fatal", error: String(e) }) + "\n");
  process.exit(1);
}

// Pre-allocated output capture buffers (256 KB each).
const OUT_BUF_SIZE = 256 * 1024;
const outBuf = Buffer.alloc(OUT_BUF_SIZE);
const errBuf = Buffer.alloc(OUT_BUF_SIZE);

// ── init ─────────────────────────────────────────────────────────────────────

if ((lib.se_init() as number) !== 0) {
  process.stdout.write(JSON.stringify({ type: "fatal", error: "se_init() failed" }) + "\n");
  process.exit(1);
}

// ── helpers ───────────────────────────────────────────────────────────────────

// bun:ffi requires string args to be null-terminated buffers, not plain strings.
function toCString(s: string): Buffer {
  return Buffer.from(s + "\0");
}

function send(obj: object): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function popOutput(): string {
  const n = lib.se_pop_output(ptr(outBuf), OUT_BUF_SIZE) as number;
  return n > 0 ? outBuf.subarray(0, n).toString("utf8") : "";
}

function popErrout(): string {
  const n = lib.se_pop_errout(ptr(errBuf), OUT_BUF_SIZE) as number;
  return n > 0 ? errBuf.subarray(0, n).toString("utf8") : "";
}

function lastError(): string {
  return (lib.se_last_error() as string | null) ?? "";
}

// ── command handlers ──────────────────────────────────────────────────────────

function handleLoad(req: { path: string }): object {
  const ret = lib.se_load(ptr(toCString(req.path))) as number;
  if (ret !== 0) {
    return { ok: false, se_error: popErrout() || lastError() || "se_load() failed" };
  }
  return {
    ok: true,
    energy:       lib.se_get_energy() as number,
    area:         lib.se_get_area()   as number,
    scale:        lib.se_get_scale()  as number,
    vertex_count: lib.se_get_vertex_count() as number,
    edge_count:   lib.se_get_edge_count()   as number,
    facet_count:  lib.se_get_facet_count()  as number,
  };
}

function handleRun(req: { command: string }): object {
  const ret = lib.se_run(ptr(toCString(req.command))) as number;
  if (ret !== 0) {
    return { ok: false, se_error: popErrout() || lastError() || "se_run() failed" };
  }
  return {
    ok: true,
    output: popOutput(),
    energy: lib.se_get_energy() as number,
    area:   lib.se_get_area()   as number,
  };
}

function handleMesh(): object {
  const vcount = lib.se_get_vertex_count() as number;
  const vbuf   = new Float64Array(vcount * 3);
  const idbuf  = new Int32Array(vcount);
  const vn     = lib.se_get_vertices(ptr(vbuf), vcount) as number;
  lib.se_get_vertex_ids(ptr(idbuf), vcount);

  const vertices:   number[][] = [];
  const vertex_ids: number[]   = [];
  for (let i = 0; i < vn; i++) {
    vertices.push([vbuf[i * 3], vbuf[i * 3 + 1], vbuf[i * 3 + 2]]);
    vertex_ids.push(idbuf[i]);
  }

  const fcount = lib.se_get_facet_count() as number;
  const fbuf   = new Int32Array(fcount * 3);
  const fn_    = lib.se_get_facets(ptr(fbuf), fcount) as number;
  const facets: number[][] = [];
  for (let i = 0; i < fn_; i++) {
    facets.push([fbuf[i * 3], fbuf[i * 3 + 1], fbuf[i * 3 + 2]]);
  }

  const bcount = lib.se_get_body_count() as number;
  const volbuf = new Float64Array(bcount);
  const prebuf = new Float64Array(bcount);
  lib.se_get_body_volumes(ptr(volbuf), ptr(prebuf), bcount);
  const body_volumes: Record<string, number> = {};
  for (let i = 0; i < bcount; i++) body_volumes[String(i + 1)] = volbuf[i];

  return { ok: true, vertices, vertex_ids, facets, body_volumes };
}

function handleIterate(req: { steps: number }): void {
  const steps       = req.steps;
  const energyStart = lib.se_get_energy() as number;
  let   stepsDone   = 0;
  const BATCH       = 10;

  while (stepsDone < steps) {
    const n   = Math.min(BATCH, steps - stepsDone);
    const ret = lib.se_run(ptr(toCString(`g ${n}`))) as number;
    if (ret !== 0) {
      send({ type: "result", ok: false, se_error: popErrout() || lastError() || "iteration failed" });
      return;
    }
    stepsDone += n;
    send({ type: "progress", step: stepsDone, total: steps, energy: lib.se_get_energy() as number });
  }

  send({
    type:            "result",
    ok:              true,
    steps_completed: stepsDone,
    energy_start:    energyStart,
    energy_end:      lib.se_get_energy() as number,
  });
}

// ── main loop ─────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line: string) => {
  line = line.trim();
  if (!line) return;

  let req: { cmd: string } & Record<string, unknown>;
  try {
    req = JSON.parse(line);
  } catch {
    send({ type: "result", ok: false, error: "invalid JSON" });
    return;
  }

  try {
    switch (req.cmd) {
      case "load":
        send({ type: "result", ...handleLoad(req as { path: string }) });
        break;
      case "run":
        send({ type: "result", ...handleRun(req as { command: string }) });
        break;
      case "mesh":
        send({ type: "result", ...handleMesh() });
        break;
      case "iterate":
        handleIterate(req as { steps: number });
        break;
      default:
        send({ type: "result", ok: false, error: `unknown cmd: ${req.cmd}` });
    }
  } catch (e) {
    send({ type: "result", ok: false, error: String(e) });
  }
});
