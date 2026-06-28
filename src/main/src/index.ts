import Electrobun, { BrowserWindow }                     from "electrobun/bun";
import { resolve, join, basename, extname }               from "path";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { config }         from "./config";
import * as sessionStore  from "./session-store";
import * as seManager     from "./se-manager";
import * as jobRunner     from "./job-runner";

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

// Register all bun-side RPC handlers for the webview to call.
// setRequestHandler replaces the handler object atomically — no per-method addHandler API exists.
(win.webview.rpc as any).setRequestHandler({

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
                last_accessed: new Date(),
            };
            sessionStore.put(session);
            return { ...session, last_accessed: session.last_accessed.toISOString() };
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

        iterate: async (payload: { sessionId: string; steps?: number }) => {
            const { sessionId } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            const steps = Math.max(1, Math.min(1000, (payload.steps ?? 100) | 0));

            const job = await jobRunner.submitJob(sessionId, steps, (step, total, energy) => {
                // Push step-by-step progress into the webview via CustomEvent
                win.webview.executeJavascript(
                    `window.dispatchEvent(new CustomEvent('se-progress', { detail: ${JSON.stringify({ sessionId, step, total, energy })} }))`
                );
            });

            return job;
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

            return result;
        },

        getMesh: async (payload: { sessionId: string; scalars?: string }) => {
            const { sessionId, scalars } = payload;
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error("Session not found");

            return await seManager.getMesh(sessionId, scalars);
        },
    });
