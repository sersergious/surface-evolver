/**
 * electrobun preBuild hook — build the headless libse for the current platform
 * and stage it at build-native/libse-<os>-<arch>.<ext> so electrobun.config.ts
 * can copy it into the app bundle. Runs on each CI runner (macOS/Windows/Linux).
 *
 * Requires cmake + a C toolchain on PATH (the runner provides them).
 */
import { $ } from "bun";
import { mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const os   = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const ext  = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
const BUILD = "cmake-build-release";

await $`cmake -B ${BUILD} -DSE_HEADLESS=ON -DCMAKE_BUILD_TYPE=Release`;
await $`cmake --build ${BUILD} --config Release`;

// Locate the produced shared library (name/location differs per toolchain:
// mac libse.dylib, linux libse.so, Windows se.dll possibly under Release/).
const glob = new Bun.Glob(`**/{libse,se}.${ext}`);
let built: string | undefined;
for await (const p of glob.scan({ cwd: BUILD, absolute: true })) { built = p; break; }
if (!built) throw new Error(`build-native: no libse.${ext} found under ${BUILD}/`);

mkdirSync("build-native", { recursive: true });
const staged = join("build-native", `libse-${os}-${arch}.${ext}`);
copyFileSync(built, staged);
console.log(`build-native: staged ${built} -> ${staged}`);
