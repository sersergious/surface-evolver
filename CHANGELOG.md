# Changelog

Notable changes per release. Generated from Conventional Commits; see `git log`
for the full history.

## Unreleased

Recommended next version: **0.3.0** — a `feat:` (the worker port) plus a
C-API removal that is breaking for any out-of-tree consumer of `se_api.h`,
under pre-1.0 semver.

### Added

- **Rust worker sidecar** (`worker-rs/`) replacing the bun:ffi one. Standalone
  crate depending only on `libloading` + `serde_json`; deliberately not a
  workspace member, because a workspace root would relocate `src-tauri/target/`,
  which CI artifact paths and tauri's bundle output hard-code.
- **Worker test suites** where there were none: `tests/ffi_signatures.rs` parses
  `se_api.h` and `src/ffi.rs` and asserts they agree (these are unchecked
  `unsafe extern "C"` declarations, so drift is UB rather than a compile error;
  mutation-tested to confirm it fails on both arg-type drift and header-only
  additions), and `tests/smoke.rs` drives the built binary over stdin. Both run
  in CI.
- **Foam / cellular model audit** and an **architecture assessment**, both
  measured rather than estimated — see `BACKLOG.md`.

### Changed

- **Sidecar 58 MB → 345 KB** (168x). Bundled `.app` ~12 MB, DMG 5.1 MB.
- **The macOS codesign workaround is gone.** bun 1.3.14 emitted binary layouts
  that failed `codesign` strict validation outright; that forced a strip/re-sign
  step plus `--bytecode`. A normal Rust binary signs like any other, so
  `scripts/tauri-before.ts` no longer touches `codesign` at all.
- `se_api.c` **1343 → 856 lines**: dropped the 12 accessors the app never called
  (six vertex scalar fields, facet normals, edge length/density, three generic
  attribute accessors) plus the two statics they exclusively owned. Header
  228 → 181. Recoverable from git history if a feature ever needs one.
- C test suite 95 → 72 assertions — exactly the coverage for the deleted code.

### Fixed

- **Session-restore race.** A slow lazy restore could kill the worker of a file
  the user had already opened, leaving the UI holding a session id the worker no
  longer served — dead until app restart. Guarded on three sides.
- **Failed load left a broken worker registered** as the active session, with
  undefined engine state after `se_load` failed.
- **`persist()` blocked the command path.** The dump round-trip is MBs on a
  refined mesh; it now runs on a background thread.
- **`cp` in the build script would have broken Windows.** Bun Shell's
  cross-platform builtins do not include `cp`, so it falls through to PATH,
  which on Windows has none. Uses `copyFileSync` now. Not reproducible on macOS.
- **Stale `se_get_vertices` header** documented an `sdim`-wide stride while the
  implementation always writes exactly 3 doubles. Sizing a buffer from the
  header would under-allocate on the `sdim=2` foam files and overflow the heap.
- Worker loop bounds now clamp to the allocated buffer rather than trusting the
  C return value, and the `unwrap()`s in `set_settings` are gone.

### Documentation

- README known-issues gained the periodic wrap-around and 2-D STRING rendering
  limitations, with the verified CLI workaround for reading cell areas.
- Corrected several stale claims: an `iterate` worker command that never
  existed, a `progress` message nothing emits, "the worker's single JS thread"
  as the reason a heartbeat is impossible, and pre-Tauri paths.

## 0.2.0 — 2026-07-08

Ported the desktop app from Electrobun to **Tauri v2** (Rust backend + system
webview), added **Windows** support (libse via MinGW/MSYS2) alongside macOS and
Linux, re-forked the C engine to the flat upstream layout, and flattened the
repo (`src/views` → `ui/`, `src/main` → `worker/`).

## 0.1.1 — 2026-07-02

Electrobun-era build with macOS + Linux artifacts.
