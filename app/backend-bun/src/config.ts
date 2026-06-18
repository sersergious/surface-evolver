export const config = {
  seLibPath:    process.env.SE_LIB_PATH    ?? "/app/libse.so",
  seFeDdir:     process.env.SE_FE_DIR      ?? "/app/fe",
  host:         process.env.BACKEND_HOST   ?? "0.0.0.0",
  port:         parseInt(process.env.BACKEND_PORT  ?? "8000", 10),
  corsOrigins:  (process.env.CORS_ORIGINS  ?? "http://localhost:3000,http://localhost:5173").split(","),
  demoUsername: process.env.DEMO_USERNAME  ?? "demo",
  demoPassword: process.env.DEMO_PASSWORD  ?? "",
  maxSessions:  parseInt(process.env.MAX_SESSIONS ?? "10", 10),
} as const;
