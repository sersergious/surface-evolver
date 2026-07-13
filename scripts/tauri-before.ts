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
const sidecar = `src-tauri/binaries/se-worker-${triple}${exe}`;
await $`bun build --compile --outfile ${sidecar} worker/se-worker.ts`;
if (process.platform === "darwin") {
  // bun's embedded ad-hoc signature fails codesign strict validation, which
  // breaks tauri's bundle signing — strip and re-sign.
  await $`codesign --remove-signature ${sidecar}`;
  await $`codesign --force -s - ${sidecar}`;
}

// 3. Tailwind
await $`bun run --cwd ui css`;
