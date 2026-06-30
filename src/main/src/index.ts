import Electrobun, { BrowserWindow }                     from "electrobun/bun";
import { resolve, join, basename, extname }               from "path";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
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

const UNSUPPORTED_FE = [
    /^\s*SIMPLEX_REPRESENTATION\b/i,
    /^\s*space_dimension\s+[12]\b/i,
];
function isRenderable(filePath: string): boolean {
    try {
        const lines = readFileSync(filePath, "utf8").split("\n").slice(0, 120);
        return !lines.some(l => UNSUPPORTED_FE.some(re => re.test(l)));
    } catch { return false; }
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
    titleBarStyle: 'hiddenInset',
    trafficLightOffset: { x: 12, y: 14 },
});

// Native menu bar + keyboard accelerators → forwarded to the webview as se-menu.
installAppMenu(win);

// Register all bun-side RPC handlers for the webview to call.
// setRequestHandler replaces the handler object atomically — no per-method addHandler API exists.
(win.webview.rpc as any).setRequestHandler({

        // Returns the surface restored from the last run's snapshot, or null.
        getRestore: async () => {
            const s = await restorePromise;
            return s ? { ...s, last_accessed: s.last_accessed.toISOString() } : null;
        },

        listFiles: async () => {
            const feDir = resolve(config.seFeDdir);
            try {
                return readdirSync(feDir)
                    .filter(f => f.endsWith(".fe") && isRenderable(join(feDir, f)))
                    .sort();
            } catch { return []; }
        },

        createSession: async (payload: { fe_file: string }) => {
            if (!payload.fe_file) throw new Error("fe_file is required");

            const feDir  = resolve(config.seFeDdir);
            const fePath = resolve(join(feDir, payload.fe_file));

            if (!fePath.startsWith(feDir + "/") && fePath !== feDir)
                throw new Error("Invalid file path");

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
            // vertex_attributes ride the response (not stored) — the viewer uses
            // them to populate custom-attribute colormaps.
            return {
                ...session,
                vertex_attributes: stats.vertex_attributes,
                last_accessed: session.last_accessed.toISOString(),
            };
        },

        uploadFile: async (payload: { filename: string; content: string }) => {
            if (!payload.filename || !payload.content)
                throw new Error("filename and content are required");
            if (!payload.filename.endsWith(".fe"))
                throw new Error("Only .fe files are accepted");

            const safeName = basename(payload.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
            const feDir    = resolve(config.seFeDdir);
            const destPath = resolve(join(feDir, safeName));
            if (!destPath.startsWith(feDir + "/")) throw new Error("Invalid filename");
            if (existsSync(destPath)) throw new Error(`File '${safeName}' already exists — rename and retry`);

            const buf = Buffer.from(payload.content, "base64");
            if (buf.length > MAX_UPLOAD_BYTES) throw new Error("File exceeds 5 MB limit");

            // Wrap in a plain Uint8Array view: @types/node 22+ types Buffer as
            // Buffer<ArrayBuffer>, which trips writeFileSync's ArrayBufferView param.
            writeFileSync(destPath, new Uint8Array(buf));
            return { filename: safeName, size_bytes: buf.length, renderable: isRenderable(destPath) };
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
            const fePath  = resolve(join(config.seFeDdir, session.fe_file));
            const content = readFileSync(fePath, "utf8");
            return { filename: basename(session.fe_file), content };
        },

        updateFile: async (payload: { filename: string; content: string }) => {
            if (!payload.filename || typeof payload.content !== 'string')
                throw new Error("filename and content are required");
            const safeName = basename(payload.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
            const feDir    = resolve(config.seFeDdir);
            const destPath = resolve(join(feDir, safeName));
            if (!destPath.startsWith(feDir + "/")) throw new Error("Invalid filename");
            writeFileSync(destPath, payload.content, "utf8");
            return { filename: safeName, size_bytes: payload.content.length };
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

        getMesh: async (payload: { sessionId: string; scalars?: string; colors?: boolean }) => {
            const { sessionId, scalars, colors } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            return await seManager.getMesh(sessionId, scalars, colors);
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
