import { resolve, join } from "path";

export const config = {
  seLibPath:    process.env.SE_LIB_PATH    ?? resolve(join(import.meta.dir, "../../../cmake-build-debug/libse.dylib")),
  seFeDdir:     process.env.SE_FE_DIR      ?? resolve(join(import.meta.dir, "../../../fe")),
  seWorkerPath: process.env.SE_WORKER_PATH ?? resolve(join(import.meta.dir, "se-worker.ts")),
  host:         process.env.BACKEND_HOST   ?? "0.0.0.0",
  port:         parseInt(process.env.BACKEND_PORT  ?? "8000", 10),
  corsOrigins:  (process.env.CORS_ORIGINS  ?? "http://localhost:3000,http://localhost:5173").split(","),
  demoUsername: process.env.DEMO_USERNAME  ?? "demo",
  demoPassword: process.env.DEMO_PASSWORD  ?? "",
  maxSessions:  parseInt(process.env.MAX_SESSIONS ?? "10", 10),
} as const;
