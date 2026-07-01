import { resolve, join } from "path";
import { homedir } from "os";

const libName = process.platform === "darwin" ? "libse.dylib" : "libse.so";

export const config = {
  stateDir:     process.env.SE_STATE_DIR   ?? resolve(join(homedir(), ".surface-evolver")),
  seLibPath:    process.env.SE_LIB_PATH    ?? resolve(join(import.meta.dir, "../../../cmake-build-debug", libName)),
  seFeDdir:     process.env.SE_FE_DIR      ?? resolve(join(import.meta.dir, "../../../fe")),
  seWorkerPath: process.env.SE_WORKER_PATH ?? resolve(join(import.meta.dir, "se-worker.ts")),
} as const;
