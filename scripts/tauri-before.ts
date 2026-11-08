/**
 * Tauri beforeDevCommand/beforeBuildCommand — stages everything the Rust app
 * bundles: the headless libse (build-native/), the compiled se-worker sidecar
 * (src-tauri/binaries/, target-triple suffixed as externalBin requires), and
 * the compiled Tailwind CSS.
 */
import { $ } from "bun";
import { copyFileSync, mkdirSync } from "fs";

// 1. headless libse → build-native/libse-<os>-<arch>.<ext>
await $`bun scripts/build-native.ts`;

// 2. worker sidecar: Rust binary that dlopens libse at runtime
// (src-tauri/worker/ — a standalone crate, not a workspace member; see its
// Cargo.toml for why that matters to the binary size).
// Staged with the target-triple suffix that tauri's externalBin requires.
// No codesign workaround here any more — that existed only because bun's
// --compile output failed codesign strict validation. A normal Rust binary
// signs like any other, so tauri bundles it without help.
const triple = (await $`rustc -vV`.text()).match(/host: (\S+)/)![1];
const sidecar = `src-tauri/binaries/se-worker-${triple}`;
await $`cargo build --release --manifest-path src-tauri/worker/Cargo.toml`;
mkdirSync("src-tauri/binaries", { recursive: true });
copyFileSync("src-tauri/worker/target/release/se-worker", sidecar);

// 3. Tailwind
await $`bun run --cwd ui css`;
