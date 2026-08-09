/**
 * Tauri beforeDevCommand/beforeBuildCommand — stages everything the Rust app
 * bundles: the headless libse (build-native/), the compiled se-worker sidecar
 * (src-tauri/binaries/, target-triple suffixed as externalBin requires), and
 * the compiled Tailwind CSS.
 */
import { $ } from "bun";

// 1. headless libse → build-native/libse-<os>-<arch>.<ext>
await $`bun scripts/build-native.ts`;

// 2. worker sidecar: Rust binary that dlopens libse at runtime (worker-rs/).
// Staged with the target-triple suffix that tauri's externalBin requires.
// No codesign workaround here any more — that existed only because bun's
// --compile output failed codesign strict validation. A normal Rust binary
// signs like any other, so tauri bundles it without help.
const triple = (await $`rustc -vV`.text()).match(/host: (\S+)/)![1];
const exe = process.platform === "win32" ? ".exe" : "";
const sidecar = `src-tauri/binaries/se-worker-${triple}${exe}`;
await $`cargo build --release --manifest-path worker-rs/Cargo.toml`;
await $`mkdir -p src-tauri/binaries`;
await $`cp worker-rs/target/release/se-worker${exe} ${sidecar}`;

// 3. Tailwind
await $`bun run --cwd ui css`;
