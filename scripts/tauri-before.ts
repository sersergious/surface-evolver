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
// --bytecode: faster sidecar startup (it is spawned once per session), and it
// also lands on a binary layout that codesign accepts. bun 1.3.14's plain
// --compile output for this file cannot be signed at all — `codesign
// --remove-signature` dies with "internal error in Code Signing subsystem",
// and force-signing without stripping leaves it failing strict validation,
// which makes tauri's bundle signing fail on the subcomponent. Verified by
// building all four variants; only --bytecode both signs and runs. Don't drop
// this flag without re-checking the codesign step below.
await $`bun build --compile --bytecode --outfile ${sidecar} worker/se-worker.ts`;
if (process.platform === "darwin") {
  // bun's embedded ad-hoc signature fails codesign strict validation, which
  // breaks tauri's bundle signing — strip and re-sign.
  await $`codesign --remove-signature ${sidecar}`;
  await $`codesign --force -s - ${sidecar}`;
}

// 3. Tailwind
await $`bun run --cwd ui css`;
