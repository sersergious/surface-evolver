/**
 * Packaged-app resource resolution. Imported FIRST by index.ts (before config).
 *
 * In dev, the launch script sets SE_LIB_PATH / SE_FE_DIR / SE_WORKER_PATH. When
 * those are absent we're running from a packaged bundle, so derive them from the
 * app's Resources folder. Setting them on process.env means the spawned worker
 * (se-manager passes `env: process.env`) resolves the same paths.
 */
import Electrobun from "electrobun/bun";
import { join } from "path";
import { existsSync } from "fs";

if (!process.env.SE_LIB_PATH) {
  const R    = Electrobun.PATHS.RESOURCES_FOLDER;
  const ext  = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
  const os   = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const lib  = `libse-${os}-${arch}.${ext}`;

  // `copy` destinations land under Resources/app; probe both bases defensively.
  const bases = [join(R, "app"), R];
  const find  = (rel: string) => bases.map(b => join(b, rel)).find(existsSync) ?? join(bases[0], rel);

  process.env.SE_LIB_PATH    = find(join("native", lib));
  process.env.SE_FE_DIR      = find("fe");
  process.env.SE_WORKER_PATH = find(join("worker", "se-worker.ts"));
}
