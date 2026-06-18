/**
 * Surface Evolver API — Bun HTTP + WebSocket server.
 *
 * Routes (identical surface to the Python/FastAPI backend):
 *   GET  /health
 *   GET  /api/files
 *   GET/POST/DELETE /api/sessions[/:id]
 *   POST /api/sessions/:id/iterate  → 202 JobResult
 *   POST /api/sessions/:id/run      → RunCommandResponse
 *   GET  /api/sessions/:id/mesh     → MeshData
 *   GET/DELETE /api/jobs/:id
 *   WS   /api/ws/sessions/:id/progress
 */

import { readdirSync, readFileSync } from "fs";
import { resolve, join }             from "path";
import { timingSafeEqual }           from "crypto";
import type { ServerWebSocket }      from "bun";

import { config }         from "./config";
import * as sessionStore  from "./session-store";
import * as seManager     from "./se-manager";
import * as jobRunner     from "./job-runner";
import * as wsHub         from "./ws-hub";

// ── file listing ──────────────────────────────────────────────────────────────

const UNSUPPORTED = [
  /^\s*SIMPLEX_REPRESENTATION\b/i,
  /^\s*space_dimension\s+[12]\b/i,
];

function isRenderable(filePath: string): boolean {
  try {
    const lines = readFileSync(filePath, "utf8").split("\n").slice(0, 120);
    return !lines.some(l => UNSUPPORTED.some(re => re.test(l)));
  } catch { return false; }
}

function listFiles(): string[] {
  try {
    return readdirSync(config.seFeDdir)
      .filter(f => f.endsWith(".fe") && isRenderable(join(config.seFeDdir, f)))
      .sort();
  } catch { return []; }
}

// ── rate limiter ──────────────────────────────────────────────────────────────

class RateLimiter {
  private windows = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  check(ip: string): boolean {
    if (!config.demoPassword) return true;   // only enforce in demo mode
    const now = Date.now();
    const w   = (this.windows.get(ip) ?? []).filter(t => now - t < this.windowMs);
    if (w.length >= this.limit) return false;
    w.push(now);
    this.windows.set(ip, w);
    return true;
  }
}

const rl = {
  createSession: new RateLimiter(5,  60_000),
  iterate:       new RateLimiter(10, 60_000),
  run:           new RateLimiter(30, 60_000),
};

// ── auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: Request): boolean {
  if (!config.demoPassword) return true;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Basic ")) return false;
  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const colon   = decoded.indexOf(":");
  if (colon < 0) return false;
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  if (user !== config.demoUsername) return false;
  const a = Buffer.from(pass);
  const b = Buffer.from(config.demoPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── CORS ──────────────────────────────────────────────────────────────────────

function corsHeaders(req: Request): Record<string, string> {
  const origin  = req.headers.get("Origin") ?? "";
  const allowed = config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0] ?? "*";
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// ── response helpers ──────────────────────────────────────────────────────────

function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function detail(msg: string, status: number, req: Request): Response {
  return json({ detail: msg }, status, corsHeaders(req));
}

function clientIp(req: Request): string {
  return req.headers.get("X-Real-IP") ?? req.headers.get("X-Forwarded-For") ?? "unknown";
}

// ── route handlers ────────────────────────────────────────────────────────────

async function handleCreateSession(req: Request): Promise<Response> {
  if (!rl.createSession.check(clientIp(req))) return detail("Rate limit exceeded", 429, req);

  let body: { fe_file?: string };
  try { body = await req.json(); } catch { return detail("Invalid JSON body", 400, req); }
  if (!body.fe_file) return detail("fe_file is required", 400, req);

  if (sessionStore.count() >= config.maxSessions)
    return detail("Maximum concurrent sessions reached", 429, req);

  if (seManager.isBusy())
    return new Response(JSON.stringify({ detail: "SE is busy — retry after current operation completes" }), {
      status: 409, headers: { "Content-Type": "application/json", "Retry-After": "1", ...corsHeaders(req) },
    });

  const feDir  = resolve(config.seFeDdir);
  const fePath = resolve(join(feDir, body.fe_file));
  if (!fePath.startsWith(feDir + "/") && fePath !== feDir)
    return detail("Invalid file path", 400, req);

  let stat: { isFile(): boolean } | null = null;
  try { stat = Bun.file(fePath).size >= 0 ? { isFile: () => true } : null; } catch { stat = null; }
  if (!stat) return detail(`File not found: ${body.fe_file}`, 404, req);

  const sessionId = crypto.randomUUID();
  let   stats: Awaited<ReturnType<typeof seManager.loadSession>>;
  try {
    stats = await seManager.loadSession(sessionId, fePath);
  } catch (e) {
    return detail(String(e), 500, req);
  }

  const session: sessionStore.SessionState = {
    session_id:    sessionId,
    fe_file:       body.fe_file,
    energy:        stats.energy,
    area:          stats.area,
    scale:         stats.scale,
    vertex_count:  stats.vertex_count,
    edge_count:    stats.edge_count,
    facet_count:   stats.facet_count,
    last_accessed: new Date(),
  };
  sessionStore.put(session);
  return json(sessionToResponse(session), 201, corsHeaders(req));
}

function sessionToResponse(s: sessionStore.SessionState) {
  return { ...s, last_accessed: s.last_accessed.toISOString() };
}

async function handleIterate(req: Request, sessionId: string): Promise<Response> {
  if (!rl.iterate.check(clientIp(req))) return detail("Rate limit exceeded", 429, req);
  const session = sessionStore.get(sessionId);
  if (!session) return detail("Session not found", 404, req);
  if (seManager.isBusy())
    return new Response(JSON.stringify({ detail: "SE is busy — retry after current operation completes" }), {
      status: 409, headers: { "Content-Type": "application/json", "Retry-After": "1", ...corsHeaders(req) },
    });

  let body: { steps?: number };
  try { body = await req.json(); } catch { body = {}; }
  const steps = Math.max(1, Math.min(1000, (body.steps ?? 100) | 0));

  const job = await jobRunner.submitJob(sessionId, steps, (step, total, energy) => {
    wsHub.broadcast(sessionId, { type: "progress", step, total, energy });
  });
  return json(job, 202, corsHeaders(req));
}

async function handleRun(req: Request, sessionId: string): Promise<Response> {
  if (!rl.run.check(clientIp(req))) return detail("Rate limit exceeded", 429, req);
  const session = sessionStore.get(sessionId);
  if (!session) return detail("Session not found", 404, req);
  if (seManager.isBusy())
    return new Response(JSON.stringify({ detail: "SE is busy — retry after current operation completes" }), {
      status: 409, headers: { "Content-Type": "application/json", "Retry-After": "1", ...corsHeaders(req) },
    });

  let body: { command?: string };
  try { body = await req.json(); } catch { return detail("Invalid JSON body", 400, req); }
  if (!body.command) return detail("command is required", 400, req);
  if (body.command.length > 512) return detail("command too long", 400, req);

  let result: Awaited<ReturnType<typeof seManager.runCommand>>;
  try {
    result = await seManager.runCommand(sessionId, body.command);
  } catch (e: unknown) {
    const err = e as Error & { isSEError?: boolean };
    if (err.isSEError) return detail(err.message, 422, req);
    if (err.message?.includes("not currently loaded")) return detail(err.message, 409, req);
    return detail(String(e), 500, req);
  }

  if (session) {
    session.energy = result.energy;
    session.area   = result.area;
    sessionStore.put(session);
  }
  return json(result, 200, corsHeaders(req));
}

async function handleGetMesh(req: Request, sessionId: string): Promise<Response> {
  const session = sessionStore.get(sessionId);
  if (!session) return detail("Session not found", 404, req);
  if (seManager.isBusy())
    return new Response(JSON.stringify({ detail: "SE is busy — retry after current operation completes" }), {
      status: 409, headers: { "Content-Type": "application/json", "Retry-After": "1", ...corsHeaders(req) },
    });

  try {
    const mesh = await seManager.getMesh(sessionId);
    return json(mesh, 200, corsHeaders(req));
  } catch (e: unknown) {
    const err = e as Error & { isSEError?: boolean };
    if (err.isSEError) return detail(err.message, 422, req);
    if (err.message?.includes("not currently loaded")) return detail(err.message, 409, req);
    return detail(String(e), 500, req);
  }
}

// ── router ────────────────────────────────────────────────────────────────────

const RE_SESSION    = /^\/api\/sessions\/([^/]+)$/;
const RE_ITERATE    = /^\/api\/sessions\/([^/]+)\/iterate$/;
const RE_RUN        = /^\/api\/sessions\/([^/]+)\/run$/;
const RE_MESH       = /^\/api\/sessions\/([^/]+)\/mesh$/;
const RE_JOB        = /^\/api\/jobs\/([^/]+)$/;
const RE_WS_PROG    = /^\/api\/ws\/sessions\/([^/]+)\/progress$/;

async function route(req: Request, path: string, method: string): Promise<Response> {
  const cors = corsHeaders(req);

  // ── health ──
  if (method === "GET" && path === "/health") return json({ status: "ok" });

  // ── files ──
  if (method === "GET" && path === "/api/files") return json(listFiles(), 200, cors);

  // ── sessions collection ──
  if (path === "/api/sessions") {
    if (method === "GET")  return json(sessionStore.all().map(sessionToResponse), 200, cors);
    if (method === "POST") return handleCreateSession(req);
  }

  // ── single session ──
  let m = RE_SESSION.exec(path);
  if (m) {
    const id = m[1];
    if (method === "GET") {
      const s = sessionStore.get(id);
      return s ? json(sessionToResponse(s), 200, cors) : detail("Session not found", 404, req);
    }
    if (method === "DELETE") {
      if (!sessionStore.del(id)) return detail("Session not found", 404, req);
      seManager.clearSession(id);
      return new Response(null, { status: 204, headers: cors });
    }
  }

  // ── iterate ──
  m = RE_ITERATE.exec(path);
  if (m && method === "POST") return handleIterate(req, m[1]);

  // ── run ──
  m = RE_RUN.exec(path);
  if (m && method === "POST") return handleRun(req, m[1]);

  // ── mesh ──
  m = RE_MESH.exec(path);
  if (m && method === "GET") return handleGetMesh(req, m[1]);

  // ── jobs ──
  m = RE_JOB.exec(path);
  if (m) {
    const id = m[1];
    if (method === "GET") {
      const job = jobRunner.getJob(id);
      return job ? json(job, 200, cors) : detail("Job not found", 404, req);
    }
    if (method === "DELETE") {
      return jobRunner.cancelJob(id)
        ? new Response(null, { status: 204, headers: cors })
        : detail("Job not found or already finished", 404, req);
    }
  }

  return detail("Not found", 404, req);
}

// ── idle eviction (every 5 min, evict sessions idle > 30 min) ────────────────

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const s of sessionStore.all()) {
    if (s.last_accessed.getTime() < cutoff) {
      sessionStore.del(s.session_id);
      seManager.clearSession(s.session_id);
      console.info(`[evict] idle session ${s.session_id}`);
    }
  }
}, 5 * 60 * 1000);

// ── server ────────────────────────────────────────────────────────────────────

const server = Bun.serve<{ sessionId: string }>({
  hostname: config.host,
  port:     config.port,

  fetch(req, server) {
    const url    = new URL(req.url);
    const path   = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(req) });

    // WebSocket upgrade (no auth — HTTPBasic is incompatible with WS upgrade)
    const wsMatch = RE_WS_PROG.exec(path);
    if (wsMatch && method === "GET") {
      const sessionId = wsMatch[1];
      if (!sessionStore.exists(sessionId))
        return new Response("Session not found", { status: 4004 });
      const ok = server.upgrade(req, { data: { sessionId } });
      return ok ? undefined as unknown as Response : new Response("Upgrade failed", { status: 400 });
    }

    // Auth guard on all other routes
    if (!checkAuth(req)) {
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status:  401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Basic realm="demo"', ...corsHeaders(req) },
      });
    }

    return route(req, path, method);
  },

  websocket: {
    open(ws: ServerWebSocket<{ sessionId: string }>) {
      wsHub.register(ws.data.sessionId, ws);
    },
    message(_ws: ServerWebSocket<{ sessionId: string }>, _msg: string | Buffer) {
      // keep-alive pings from clients — nothing to do
    },
    close(ws: ServerWebSocket<{ sessionId: string }>) {
      wsHub.unregister(ws.data.sessionId, ws);
    },
  },
});

console.info(`Surface Evolver API running on http://${config.host}:${config.port}`);
