/**
 * Tauri beforeDevCommand/beforeBuildCommand — stages everything the Rust app
 * bundles: the headless libse (build-native/), the compiled se-worker sidecar
 * (src-tauri/binaries/, target-triple suffixed as externalBin requires), and
 * the compiled Tailwind CSS.
 */
import { $ } from "bun";

// 1. headless libse → build-native/libse-<os>-<arch>.<ext>
await $`bun scripts/build-native.ts`;

// 2. worker sidecar: bun-compiled single binary (bun:ffi dlopens libse at runtime)
const triple = (await $`rustc -vV`.text()).match(/host: (\S+)/)![1];
const exe = process.platform === "win32" ? ".exe" : "";
await $`bun build --compile --outfile src-tauri/binaries/se-worker-${triple}${exe} worker/se-worker.ts`;

// 3. Tailwind
await $`bun run --cwd ui css`;
