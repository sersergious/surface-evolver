import "./bootstrap-paths";   // MUST be first — injects SE_* env before ./config loads
import Electrobun, { BrowserWindow, Utils }               from "electrobun/bun";
import { resolve, join, basename, extname }               from "path";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir, homedir } from "os";
import { config }         from "./config";
import * as sessionStore  from "./session-store";
import * as seManager     from "./se-manager";
import * as persistence   from "./persistence";
import { installAppMenu } from "./app-menu";

// Best-effort snapshot of the current surface after a mutating op. Reuses SE's
// own dump so the *evolved* state (post refine/iterate) survives a restart.
// ponytail: dumps once per mutation — fine at human command pace; throttle if
// huge-mesh interactive use ever lags.
function persist(sessionId: string): void {
    void (async () => {
        try {
            const s = sessionStore.get(sessionId);
            if (!s) return;
            const { content } = await seManager.dump(sessionId);
            persistence.saveSession({
                fe_file: s.fe_file, energy: s.energy, area: s.area,
                dmp: content, saved_at: new Date().toISOString(),
            });
        } catch { /* persistence is best-effort; never surface to the user */ }
    })();
}

// On startup, reload the last surface from its saved dump. Awaited by the
// getRestore RPC so the webview never races the restore.
const restorePromise: Promise<sessionStore.SessionState | null> = (async () => {
    const saved = persistence.loadSaved();
    if (!saved) return null;
    try {
        const tmp = join(tmpdir(), `se-restore-${crypto.randomUUID()}.dmp`);
        writeFileSync(tmp, saved.dmp);
        const sessionId = crypto.randomUUID();
        const stats = await seManager.loadSession(sessionId, tmp);
        const session: sessionStore.SessionState = {
            session_id: sessionId, fe_file: saved.fe_file,
            energy: stats.energy, area: stats.area, scale: stats.scale, sdim: stats.sdim,
            vertex_count: stats.vertex_count, edge_count: stats.edge_count, facet_count: stats.facet_count,
            lagrange_order: stats.lagrange_order, last_accessed: new Date(),
        };
        sessionStore.put(session);
        return session;
    } catch {
        persistence.clearSaved();   // corrupt/unloadable snapshot — drop it
        return null;
    }
})();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// User-writable datafile dir. The bundled fe/ can be read-only in a packaged
// app (Gatekeeper translocation on macOS, /opt installs on Linux), so uploads
// and editor saves land here; reads check here first, then the bundle.
const USER_FE_DIR = join(config.stateDir, "fe");

function resolveFePath(feFile: string): string {
    const name = basename(feFile);
    const userPath = join(USER_FE_DIR, name);
    return existsSync(userPath) ? userPath : join(resolve(config.seFeDdir), name);
}

// Datafiles hidden from the picker (load/render unsupported in this build).
// - slidestr.fe: STRING model with an open (non-closed) face edge loop; engine
//   rejects it at load ("Facetedge tail vertex disagrees with prev head").
// - simplex3.fe: SIMPLEX_REPRESENTATION; loads + runs but renders empty because
//   se_get_facets is SOAPFILM-only (simplex cells aren't exposed). See BACKLOG.
// (2-D/4-D space_dimension files render fine now that se_get_vertices emits a
// fixed 3-component stride, so they are no longer filtered.)
const QUARANTINED_FE = new Set<string>(["slidestr.fe", "simplex3.fe"]);
function isRenderable(filePath: string): boolean {
    return !QUARANTINED_FE.has(basename(filePath));
}

const win = new BrowserWindow({
    title: "Surface Evolver",
    url: "views://main/index.html",
    frame: {
        x: 0,
        y: 0,
        width: 1280,
        height: 800,
    },
    // Frameless-with-inset-traffic-lights is a macOS concept; Linux keeps the
    // native titlebar so the window has close/minimize controls.
    ...(process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset" as const, trafficLightOffset: { x: 12, y: 14 } }
        : {}),
});

// Native menu bar + keyboard accelerators → forwarded to the webview as se-menu.
// Best-effort: every menu action is also reachable from the UI or the CLI pane,
// so a platform without app-menu support must not take down startup.
try { installAppMenu(win); } catch (e) { console.error("[menu] install failed:", e); }

// Register all bun-side RPC handlers for the webview to call.
// setRequestHandler replaces the handler object atomically — no per-method addHandler API exists.
(win.webview.rpc as any).setRequestHandler({

        // Returns the surface restored from the last run's snapshot, or null.
        getRestore: async () => {
            const s = await restorePromise;
            return s ? { ...s, last_accessed: s.last_accessed.toISOString() } : null;
        },

        listFiles: async () => {
            const list = (dir: string) => {
                try { return readdirSync(dir).filter(f => f.endsWith(".fe") && isRenderable(f)); }
                catch { return []; }
            };
            // User files shadow bundled ones of the same name (see resolveFePath).
            return [...new Set([...list(resolve(config.seFeDdir)), ...list(USER_FE_DIR)])].sort();
        },

        createSession: async (payload: { fe_file: string }) => {
            if (!payload.fe_file) throw new Error("fe_file is required");

            const fePath = resolveFePath(payload.fe_file);   // basename()d — no traversal
            if (!existsSync(fePath))
                throw new Error(`File not found: ${basename(payload.fe_file)}`);

            const sessionId = crypto.randomUUID();
            const stats = await seManager.loadSession(sessionId, fePath);

            const session: sessionStore.SessionState = {
                session_id:    sessionId,
                fe_file:       payload.fe_file,
                energy:        stats.energy,
                area:          stats.area,
                scale:         stats.scale,
                sdim:          stats.sdim,
                vertex_count:  stats.vertex_count,
                edge_count:    stats.edge_count,
                facet_count:   stats.facet_count,
                lagrange_order: stats.lagrange_order,
                last_accessed: new Date(),
            };
            sessionStore.put(session);
            persist(sessionId);
            return {
                ...session,
                last_accessed: session.last_accessed.toISOString(),
            };
        },

        uploadFile: async (payload: { filename: string; content: string }) => {
            if (!payload.filename || !payload.content)
                throw new Error("filename and content are required");
            if (!payload.filename.endsWith(".fe"))
                throw new Error("Only .fe files are accepted");

            const safeName = basename(payload.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
            if (existsSync(resolveFePath(safeName)))
                throw new Error(`File '${safeName}' already exists — rename and retry`);

            const buf = Buffer.from(payload.content, "base64");
            if (buf.length > MAX_UPLOAD_BYTES) throw new Error("File exceeds 5 MB limit");

            mkdirSync(USER_FE_DIR, { recursive: true });
            // Wrap in a plain Uint8Array view: @types/node 22+ types Buffer as
            // Buffer<ArrayBuffer>, which trips writeFileSync's ArrayBufferView param.
            writeFileSync(join(USER_FE_DIR, safeName), new Uint8Array(buf));
            return { filename: safeName, size_bytes: buf.length, renderable: isRenderable(safeName) };
        },

        exportDmp: async (payload: { sessionId: string }) => {
            const { sessionId } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");
            const result = await seManager.dump(sessionId);
            const stem      = basename(session.fe_file, extname(session.fe_file));
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            return { filename: `${stem}_${timestamp}.dmp`, content: result.content };
        },

        exportFe: async (payload: { sessionId: string }) => {
            const { sessionId } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");
            const content = readFileSync(resolveFePath(session.fe_file), "utf8");
            return { filename: basename(session.fe_file), content };
        },

        updateFile: async (payload: { filename: string; content: string }) => {
            if (!payload.filename || typeof payload.content !== 'string')
                throw new Error("filename and content are required");
            if (Buffer.byteLength(payload.content) > MAX_UPLOAD_BYTES)
                throw new Error("File exceeds 5 MB limit");
            const safeName = basename(payload.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
            mkdirSync(USER_FE_DIR, { recursive: true });
            writeFileSync(join(USER_FE_DIR, safeName), payload.content, "utf8");
            return { filename: safeName, size_bytes: payload.content.length };
        },

        // Write an export to ~/Downloads and reveal it. The webview can't do
        // this itself: Electrobun's WKWebView/WebKitGTK have no download
        // handler, so an <a download> on a blob URL is silently dropped.
        saveExport: async (payload: { filename: string; content: string }) => {
            if (!payload.filename || typeof payload.content !== "string")
                throw new Error("filename and content are required");
            const safeName = basename(payload.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
            const dir = join(homedir(), "Downloads");
            mkdirSync(dir, { recursive: true });
            // Avoid clobbering: foo.dmp, foo (1).dmp, foo (2).dmp, ...
            const dot  = safeName.lastIndexOf(".");
            const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
            const ext  = dot > 0 ? safeName.slice(dot) : "";
            let dest = join(dir, safeName);
            for (let i = 1; existsSync(dest); i++) dest = join(dir, `${stem} (${i})${ext}`);
            writeFileSync(dest, payload.content, "utf8");
            try { Utils.showItemInFolder(dest); } catch { /* reveal is best-effort */ }
            return { path: dest };
        },

        setScale: async (payload: { sessionId: string; scale: number }) => {
            const { sessionId, scale } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");
            if (typeof scale !== "number" || scale <= 0)
                throw new Error("scale must be a positive number");
            const result = await seManager.setScale(sessionId, scale);
            session.scale  = result.scale;
            session.energy = result.energy;
            session.area   = result.area;
            sessionStore.put(session);
            return result;
        },

        runCommand: async (payload: { sessionId: string; command: string }) => {
            const { sessionId, command } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");
            if (!command) throw new Error("command is required");

            const result = await seManager.runCommand(sessionId, command);

            session.energy = result.energy;
            session.area   = result.area;
            sessionStore.put(session);
            persist(sessionId);

            return result;
        },

        getMesh: async (payload: { sessionId: string; colors?: boolean }) => {
            const { sessionId, colors } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            return await seManager.getMesh(sessionId, colors);
        },

        quantities: async (payload: { sessionId: string }) => {
            const { sessionId } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            return await seManager.getQuantities(sessionId);
        },

        settings: async (payload: { sessionId: string }) => {
            const { sessionId } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            return await seManager.getSettings(sessionId);
        },

        setSettings: async (payload: { sessionId: string; mesh_params?: seManager.MeshParams; physics?: seManager.Physics }) => {
            const { sessionId, mesh_params, physics } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            const result = await seManager.setSettings(sessionId, { mesh_params, physics });
            session.energy = result.energy;
            session.area   = result.area;
            sessionStore.put(session);
            persist(sessionId);
            return result;
        },

        vertexInfo: async (payload: { sessionId: string; vpos: number }) => {
            const { sessionId, vpos } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");
            if (typeof vpos !== "number" || vpos < 0) throw new Error("vpos is required");

            return await seManager.getVertexInfo(sessionId, vpos);
        },

        topo: async (payload: { sessionId: string; op: string; n?: number }) => {
            const { sessionId, op, n } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");
            if (!op) throw new Error("op is required");

            const result = await seManager.runTopo(sessionId, op, n);

            session.energy = result.energy;
            session.area   = result.area;
            sessionStore.put(session);
            persist(sessionId);

            return result;
        },
    });
