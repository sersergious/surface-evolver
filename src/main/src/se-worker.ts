/**
 * SE worker subprocess.
 * Spawned once per session by se-manager.ts. Owns one libse.so instance.
 *
 * Protocol: line-delimited JSON on stdin/stdout.
 *   stdin  ← {"cmd":"load"|"run"|"mesh"|"topo"|..., ...}
 *   stdout → {"type":"result","ok":true|false, ...}
 *
 * Cancellation: manager kills the process (SIGTERM/SIGKILL). No in-band cancel cmd.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { readFileSync } from "fs";
import { dirname } from "path";
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
  se_set_scale:        { returns: FFIType.void,    args: [FFIType.double] },
  se_get_sdim:         { returns: FFIType.int,     args: [] },
  se_get_vertex_count: { returns: FFIType.int,     args: [] },
  se_get_edge_count:   { returns: FFIType.int,     args: [] },
  se_get_facet_count:  { returns: FFIType.int,     args: [] },
  se_get_body_count:   { returns: FFIType.int,     args: [] },
  se_get_vertices:     { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_ids:   { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_facets:       { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_edges:        { returns: FFIType.int,     args: [FFIType.ptr, FFIType.int] },
  se_get_bounding_box: { returns: FFIType.int,     args: [FFIType.ptr, FFIType.ptr] },
  se_get_lagrange_order:{ returns: FFIType.int,    args: [] },
  se_get_body_volumes:              { returns: FFIType.int, args: [FFIType.ptr, FFIType.ptr, FFIType.int] },
  se_get_topo_counts:               { returns: FFIType.int,    args: [FFIType.ptr, FFIType.int] },
  se_get_total_time:                { returns: FFIType.double, args: [] },
  se_get_mesh_params:               { returns: FFIType.int,    args: [FFIType.ptr, FFIType.int] },
  se_set_mesh_params:               { returns: FFIType.int,    args: [FFIType.double, FFIType.double, FFIType.double, FFIType.double] },
  se_get_physics:                   { returns: FFIType.int,    args: [FFIType.ptr, FFIType.int] },
  se_set_physics:                   { returns: FFIType.int,    args: [FFIType.double, FFIType.int, FFIType.double, FFIType.int] },
  se_get_quantity_count:            { returns: FFIType.int, args: [] },
  se_get_quantity:                  { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr] },
  se_get_method_instance_count:     { returns: FFIType.int, args: [] },
  se_get_method_instance:           { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int, FFIType.ptr, FFIType.ptr] },
  se_get_body_cm:                   { returns: FFIType.int, args: [FFIType.int, FFIType.ptr] },
  se_get_facet_colors:              { returns: FFIType.int, args: [FFIType.ptr, FFIType.ptr, FFIType.int] },
  se_get_facet_normals:             { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_edge_colors:               { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_edge_lengths:              { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_edge_densities:            { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_attribute_count:           { returns: FFIType.int, args: [FFIType.int] },
  se_get_attribute_info:            { returns: FFIType.int, args: [FFIType.int, FFIType.int, FFIType.ptr, FFIType.int, FFIType.ptr] },
  se_get_attribute_values:          { returns: FFIType.int, args: [FFIType.int, FFIType.int, FFIType.ptr, FFIType.int] },
  se_get_vertex_info:               { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.int] },
  se_get_constraint_name:           { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int] },
  se_get_vertex_mean_curvatures:    { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_valences:           { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_star_areas:         { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_force_mags:         { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_energy_density:     { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_gaussian_curvatures:{ returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
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

let loadedFilePath: string | null = null;

function handleLoad(req: { path: string }): object {
  // Resolve relative includes (e.g. crystal.fe's `Wulff "octa.wlf"`) against the
  // datafile's own directory — the engine opens them relative to the CWD.
  try { process.chdir(dirname(req.path)); } catch { /* keep current CWD */ }
  const ret = lib.se_load(ptr(toCString(req.path))) as number;
  if (ret !== 0) {
    return { ok: false, se_error: popErrout() || lastError() || "se_load() failed" };
  }
  loadedFilePath = req.path;
  const sdim    = lib.se_get_sdim() as number;
  const bbMin   = new Float64Array(sdim);
  const bbMax   = new Float64Array(sdim);
  const bbN     = lib.se_get_bounding_box(ptr(bbMin), ptr(bbMax)) as number;
  return {
    ok: true,
    energy:         lib.se_get_energy() as number,
    area:           lib.se_get_area()   as number,
    scale:          lib.se_get_scale()  as number,
    sdim,
    vertex_count:   lib.se_get_vertex_count() as number,
    edge_count:     lib.se_get_edge_count()   as number,
    facet_count:    lib.se_get_facet_count()  as number,
    lagrange_order: lib.se_get_lagrange_order() as number,
    bbox_min:          bbN > 0 ? Array.from(bbMin) : null,
    bbox_max:          bbN > 0 ? Array.from(bbMax) : null,
    total_time:        lib.se_get_total_time() as number,
  };
}

// Bare single-letter SE commands whose handlers call prompt() for keyboard
// input (command.c letter_command). Here stdin is the IPC pipe, so prompt()
// would block forever and hang the worker. None has a non-interactive inline
// form, so reject the bare command outright with a clear error. (A compound
// like "f; g" isn't caught — rare, and se-manager recovers via a fresh load.)
const INTERACTIVE_CMDS = new Set(
  ["a", "b", "f", "G", "J", "j", "k", "K", "l", "m", "n", "p", "t", "w", "W", "y", "Z", "F"],
);

function handleRun(req: { command: string }): object {
  if (INTERACTIVE_CMDS.has(req.command.trim())) {
    return {
      ok: false,
      se_error: `Command "${req.command.trim()}" requires interactive keyboard input, which this UI does not support.`,
    };
  }
  const ret = lib.se_run(ptr(toCString(req.command))) as number;
  if (ret !== 0) {
    return { ok: false, se_error: popErrout() || lastError() || "se_run() failed" };
  }
  return {
    ok: true,
    output: popOutput(),
    energy:     lib.se_get_energy() as number,
    area:       lib.se_get_area()   as number,
    total_time: lib.se_get_total_time() as number,
  };
}

function handleMesh(req?: { colors?: boolean }): object {
  const vcount = lib.se_get_vertex_count() as number;
  // bun:ffi ptr() rejects zero-length buffers, so every fill is guarded on a
  // positive count (a STRING model has 0 facets; an empty surface 0 of all).
  const vbuf   = new Float64Array(vcount * 3);
  const idbuf  = new Int32Array(vcount);
  const vn     = vcount > 0 ? lib.se_get_vertices(ptr(vbuf), vcount) as number : 0;
  if (vcount > 0) lib.se_get_vertex_ids(ptr(idbuf), vcount);

  const vertices:   number[][] = [];
  const vertex_ids: number[]   = [];
  for (let i = 0; i < vn; i++) {
    vertices.push([vbuf[i * 3], vbuf[i * 3 + 1], vbuf[i * 3 + 2]]);
    vertex_ids.push(idbuf[i]);
  }

  const fcount = lib.se_get_facet_count() as number;
  const fbuf   = new Int32Array(fcount * 3);
  const fn_    = fcount > 0 ? lib.se_get_facets(ptr(fbuf), fcount) as number : 0;
  const facets: number[][] = [];
  for (let i = 0; i < fn_; i++) {
    facets.push([fbuf[i * 3], fbuf[i * 3 + 1], fbuf[i * 3 + 2]]);
  }

  const ecount = lib.se_get_edge_count() as number;
  const ebuf   = new Int32Array(ecount * 2);
  const en     = ecount > 0 ? lib.se_get_edges(ptr(ebuf), ecount) as number : 0;
  const edges: number[][] = [];
  for (let i = 0; i < en; i++) {
    edges.push([ebuf[i * 2], ebuf[i * 2 + 1]]);
  }

  const bcount = lib.se_get_body_count() as number;
  const volbuf = new Float64Array(bcount);
  const prebuf = new Float64Array(bcount);
  if (bcount > 0) lib.se_get_body_volumes(ptr(volbuf), ptr(prebuf), bcount);
  const cmbuf = new Float64Array(3);
  const body_volumes:   Record<string, number> = {};
  const body_pressures: Record<string, number> = {};
  const body_cms: (number[] | null)[] = [];
  for (let i = 0; i < bcount; i++) {
    body_volumes[String(i + 1)]   = volbuf[i];
    body_pressures[String(i + 1)] = prebuf[i];
    const r = lib.se_get_body_cm(i, ptr(cmbuf)) as number;
    body_cms.push(r === 3 ? [cmbuf[0], cmbuf[1], cmbuf[2]] : null);
  }

  const result: Record<string, unknown> = {
    ok: true, vertices, vertex_ids, facets, edges, body_volumes, body_pressures, body_cms,
  };

  // Per-element SE colour-table indices (only when asked — keeps the hot mesh
  // payload lean otherwise).
  if (req?.colors) {
    const facet_colors: number[] = [];
    const edge_colors:  number[] = [];
    if (fcount > 0) {
      const front = new Int32Array(fcount), back = new Int32Array(fcount);
      const cn = lib.se_get_facet_colors(ptr(front), ptr(back), fcount) as number;
      for (let i = 0; i < cn; i++) facet_colors.push(front[i]);
    }
    if (ecount > 0) {
      const ec = new Int32Array(ecount);
      const cn = lib.se_get_edge_colors(ptr(ec), ecount) as number;
      for (let i = 0; i < cn; i++) edge_colors.push(ec[i]);
    }
    result.facet_colors = facet_colors;
    result.edge_colors  = edge_colors;
  }

  return result;
}

// ── structured topology ops ────────────────────────────────────────────────
// Counter order must match SE_TOPO_COUNT / se_get_topo_counts in se_api.c.
const TOPO_COUNT = 11;
const TOPO_NAMES = [
  "equi", "edge_refine", "facet_refine", "vertex_dissolve", "edge_dissolve",
  "facet_dissolve", "vertex_pop", "edge_pop", "edgeswap", "fix", "unfix",
] as const;

// Map a structured op to the SE command. Element-count deltas cover refinement;
// named-counter deltas cover topology-preserving ops (equiangulation, pops).
const TOPO_CMDS: Record<string, (n: number) => string> = {
  refine:     ()  => "r",
  equi:       (n) => `u ${n}`,
  vertex_avg: ()  => "V",
  pop:        ()  => "pop vertices",   // bare `pop` is a syntax error; needs a generator
};

function readTopoCounts(): Int32Array {
  const buf = new Int32Array(TOPO_COUNT);
  lib.se_get_topo_counts(ptr(buf), TOPO_COUNT);
  return buf;
}

function elementCounts() {
  return {
    vertices: lib.se_get_vertex_count() as number,
    edges:    lib.se_get_edge_count()   as number,
    facets:   lib.se_get_facet_count()  as number,
    bodies:   lib.se_get_body_count()   as number,
  };
}

function handleTopo(req: { op: string; n?: number }): object {
  const build = TOPO_CMDS[req.op];
  if (!build) return { ok: false, error: `unknown topology op: ${req.op}` };
  const n = typeof req.n === "number" && req.n > 0 ? Math.floor(req.n) : 1;

  const c0 = readTopoCounts();
  const e0 = elementCounts();
  const energyStart = lib.se_get_energy() as number;

  const ret = lib.se_run(ptr(toCString(build(n)))) as number;
  if (ret !== 0) {
    return { ok: false, se_error: popErrout() || lastError() || "topology op failed" };
  }

  const c1 = readTopoCounts();
  const e1 = elementCounts();

  const counts: Record<string, number> = {};
  // element-count deltas (signed — refine adds, dissolve removes)
  if (e1.vertices !== e0.vertices) counts.vertices = e1.vertices - e0.vertices;
  if (e1.edges    !== e0.edges)    counts.edges    = e1.edges    - e0.edges;
  if (e1.facets   !== e0.facets)   counts.facets   = e1.facets   - e0.facets;
  if (e1.bodies   !== e0.bodies)   counts.bodies   = e1.bodies   - e0.bodies;
  // named topology-counter deltas (only the ones that moved)
  for (let i = 0; i < TOPO_COUNT; i++) {
    const d = c1[i] - c0[i];
    if (d !== 0) counts[TOPO_NAMES[i]] = d;
  }

  const energy = lib.se_get_energy() as number;
  return {
    ok: true,
    output: popOutput(),
    counts,
    energy,
    energy_delta: energy - energyStart,
    area: lib.se_get_area() as number,
    total_time: lib.se_get_total_time() as number,
  };
}

// ── named quantities + method-instance energy breakdown ───────────────────
const NAME_SIZE = 128;

function cstr(buf: Buffer): string {
  const nul = buf.indexOf(0);
  return buf.subarray(0, nul < 0 ? buf.length : nul).toString("utf8");
}

function handleQuantities(): object {
  const nameBuf = Buffer.alloc(NAME_SIZE);
  const d0 = new Float64Array(1), d1 = new Float64Array(1), d2 = new Float64Array(1);
  const i0 = new Int32Array(1);

  const quantities: { name: string; value: number; target: number; modulus: number; flags: number }[] = [];
  const qc = lib.se_get_quantity_count() as number;
  for (let i = 0; i < qc; i++) {
    const r = lib.se_get_quantity(i, ptr(nameBuf), NAME_SIZE, ptr(d0), ptr(d1), ptr(d2), ptr(i0)) as number;
    if (r === 0)
      quantities.push({ name: cstr(nameBuf), value: d0[0], target: d1[0], modulus: d2[0], flags: i0[0] });
  }

  const methods: { name: string; type: number; value: number }[] = [];
  const mc = lib.se_get_method_instance_count() as number;
  for (let i = 0; i < mc; i++) {
    const r = lib.se_get_method_instance(i, ptr(nameBuf), NAME_SIZE, ptr(i0), ptr(d0)) as number;
    if (r === 0)
      methods.push({ name: cstr(nameBuf), type: i0[0], value: d0[0] });
  }

  return { ok: true, quantities, methods };
}

// ── element inspector ──────────────────────────────────────────────────────
const MAX_CONS = 32;

function handleVertexInfo(req: { vpos: number }): object {
  const idBuf  = new Int32Array(1);
  const xyzBuf = new Float64Array(3);
  const attrBuf = new Int32Array(1);
  const consBuf = new Int32Array(MAX_CONS);

  const nc = lib.se_get_vertex_info(req.vpos, ptr(idBuf), ptr(xyzBuf), ptr(attrBuf), ptr(consBuf), MAX_CONS) as number;
  if (nc < 0) return { ok: false, error: "invalid vertex position" };

  const nameBuf = Buffer.alloc(NAME_SIZE);
  const constraints: { idx: number; name: string }[] = [];
  for (let i = 0; i < Math.min(nc, MAX_CONS); i++) {
    const ci = consBuf[i];
    const r  = lib.se_get_constraint_name(ci, ptr(nameBuf), NAME_SIZE) as number;
    constraints.push({ idx: ci, name: r === 0 ? cstr(nameBuf) : "" });
  }

  return {
    ok: true,
    id:   idBuf[0],
    xyz:  [xyzBuf[0], xyzBuf[1], xyzBuf[2]],
    attr: attrBuf[0],
    constraints,
  };
}

// ── settings: mesh-quality params + physics globals ───────────────────────
interface MeshParams { min_area: number; min_length: number; max_len: number; temperature: number }
interface Physics { gravflag: boolean; grav_const: number; pressflag: boolean; pressure: number }

function readSettings(): { mesh_params: MeshParams; physics: Physics; total_time: number } {
  const mp = new Float64Array(4); lib.se_get_mesh_params(ptr(mp), 4);
  const ph = new Float64Array(4); lib.se_get_physics(ptr(ph), 4);
  return {
    mesh_params: { min_area: mp[0], min_length: mp[1], max_len: mp[2], temperature: mp[3] },
    physics:     { gravflag: ph[0] !== 0, grav_const: ph[1], pressflag: ph[2] !== 0, pressure: ph[3] },
    total_time:  lib.se_get_total_time() as number,
  };
}

function handleSettings(): object {
  return { ok: true, ...readSettings() };
}

function handleSetSettings(req: { mesh_params?: MeshParams; physics?: Physics }): object {
  if (req.mesh_params) {
    const m = req.mesh_params;
    for (const [k, v] of Object.entries(m))
      if (!Number.isFinite(v) || (v as number) <= 0)
        return { ok: false, error: `invalid ${k}: must be a positive finite number` };
    lib.se_set_mesh_params(m.min_area, m.min_length, m.max_len, m.temperature);
  }
  if (req.physics) {
    const p = req.physics;
    // grav/pressure may legitimately be negative or zero -> only finite-check.
    if (!Number.isFinite(p.grav_const) || !Number.isFinite(p.pressure))
      return { ok: false, error: "grav_const/pressure must be finite numbers" };
    lib.se_set_physics(p.grav_const, p.gravflag ? 1 : 0, p.pressure, p.pressflag ? 1 : 0);
  }
  // recalc through the protected command path so energy/area refresh.
  lib.se_run(ptr(toCString("recalc")));
  popOutput();
  return {
    ok: true,
    ...readSettings(),
    energy: lib.se_get_energy() as number,
    area:   lib.se_get_area()   as number,
  };
}

function handleSetScale(req: { scale: number }): object {
  if (typeof req.scale !== "number" || req.scale <= 0)
    return { ok: false, error: "scale must be a positive number" };
  (lib.se_set_scale as (s: number) => void)(req.scale);
  return {
    ok:     true,
    scale:  lib.se_get_scale()  as number,
    energy: lib.se_get_energy() as number,
    area:   lib.se_get_area()   as number,
  };
}

function handleDump(): object {
  if (!loadedFilePath) return { ok: false, error: "No file loaded" };

  const ret = lib.se_run(ptr(toCString("dump"))) as number;
  if (ret !== 0) {
    return { ok: false, se_error: popErrout() || lastError() || "dump failed" };
  }

  // SE creates <loadedFilePath>.dmp; parse output to confirm actual path.
  const out     = popOutput();
  const matched = out.match(/Dumping to (.+?)\s*\.?\s*$/m);
  const dmpPath = matched ? matched[1].replace(/\.$/, "").trim() : loadedFilePath + ".dmp";

  try {
    const content = readFileSync(dmpPath, "utf8");
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: `Could not read dump file at ${dmpPath}: ${e}` };
  }
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
        send({ type: "result", ...handleMesh(req as { colors?: boolean }) });
        break;
      case "set_scale":
        send({ type: "result", ...handleSetScale(req as { scale: number }) });
        break;
      case "topo":
        send({ type: "result", ...handleTopo(req as { op: string; n?: number }) });
        break;
      case "quantities":
        send({ type: "result", ...handleQuantities() });
        break;
      case "vertex_info":
        send({ type: "result", ...handleVertexInfo(req as { vpos: number }) });
        break;
      case "settings":
        send({ type: "result", ...handleSettings() });
        break;
      case "set_settings":
        send({ type: "result", ...handleSetSettings(req as { mesh_params?: MeshParams; physics?: Physics }) });
        break;
      case "dump":
        send({ type: "result", ...handleDump() });
        break;
      default:
        send({ type: "result", ok: false, error: `unknown cmd: ${req.cmd}` });
    }
  } catch (e) {
    send({ type: "result", ok: false, error: String(e) });
  }
});
