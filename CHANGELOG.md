# Changelog

Notable changes per release. Generated from Conventional Commits; see `git log`
for the full history.

## Unreleased

Recommended next version: **0.3.0** — a `feat:` (the worker port) plus a
C-API removal that is breaking for any out-of-tree consumer of `se_api.h`,
under pre-1.0 semver.

### Added

- **Periodic (torus) surfaces render correctly** — the last known-wrong render.
  New C accessor `se_get_edge_wraps` exposes SE's per-edge wrap code (the
  `+`/`-`/`*` notation from the datafile format) in `se_get_edges` row order;
  the worker omits wrapped edges from the mesh and reports
  `wrapped_edges_hidden`, which the viewer shows in its stat badge. Read-only —
  unlike `detorus`, which genuinely unwraps but is irreversible and stays a
  `run` escape hatch. Gated on `web.symmetry_flag`, since `E_WRAP_ATTR` has no
  storage without a symmetry group. *Measured:* `phelanc.fe` 103 of 368 edges
  hidden, remaining max/median edge length 1.49 (was a set of lines spanning the
  whole domain); `symtest.fe` and `twointor.fe` 41 each, max/median 1.00.
  Closes BACKLOG F1.
- **Stop button in the CLI pane.** The `cancel` RPC existed but had no caller;
  it is now reachable while a command is running. `se_run` is a blocking FFI
  call and cannot be interrupted in band, so this kills the worker process —
  the in-memory surface goes with it, the tab stays so the file can be
  reopened, and the last auto-snapshot is still on disk.
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

- **C API trimmed 37 → 27 exports; worker 10 → 6 commands.** Removed the
  physics/named-quantity surface: `se_get_physics`, `se_set_physics`,
  `se_get_mesh_params`, `se_set_mesh_params`, `se_get_quantity_count`,
  `se_get_quantity`, `se_get_method_instance_count`, `se_get_method_instance`,
  `se_get_total_time` and `se_set_scale` (the last had become unreachable once
  the `setScale` RPC arm went). Worker commands `settings`, `set_settings`,
  `quantities` and `set_scale` went with them, as did the `SettingsPanel`,
  `QuantitiesPanel`, `useQuantities` hook, the two `panel:*` menu items and the
  navbar `t` chip.
  **No capability was lost** — verified against the worker, not assumed:
  `set gravity_constant 980` applies, `print body[1].volume` prints, and `v`
  lists every named quantity with target and actual value (the exact table
  `QuantitiesPanel` drew), plus `print <quantity>.value` for a single one.
  Only the structured duplicate is gone. Geometry, topology ops and the vertex
  inspector are untouched.
- **Scope narrowed to the soapfilm model.** `se_load` now rejects `STRING` and
  `SIMPLEX_REPRESENTATION` datafiles with an explanatory `se_last_error()`.
  Neither model's cells can be expressed by `se_get_facets` — STRING facets are
  arbitrary polygons, SIMPLEX cells are k-simplices — so both used to render as
  a bare edge web or as nothing at all. Rejecting beats drawing a lie. The
  engine still computes them; `se_run` is unaffected.
  This removes `QUARANTINED_FE` (the filename allowlist it replaced) and the
  `renderable` field from the `uploadFile` response.
- **Bundled `fe/` trimmed 1.2 MB → 96 KB** (142 files → 21). Dropped 83 `.cmd`
  scripts (overwhelmingly export-format converters — dxf, iges, maya, povray,
  vrml, x3d, obj, ply, stl, collada — none reachable from the app), 27 `.dmp`
  files (upstream's own dump outputs; the app generates its own), and the 7
  datafiles using the now-rejected models: `100grain.fe`, `5pb.fe`,
  `knotty.fe`, `metric.fe`, `popstr.fe`, `slidestr.fe`, `simplex3.fe`.
  Kept `OCTA.WLF` — `crystal.fe` loads it via `Wulff "octa.wlf"`, the bundle's
  only cross-file dependency. **20 of 20 remaining datafiles load with facets**,
  up from 17 of 27.
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

- **One return-value convention across the C facade**, documented at the top of
  `se_api.h`: `-1` = bad arguments or genuine failure, `0` = "not applicable to
  this surface", `>0` = elements written. `se_get_facet_colors` used to report a
  non-SOAPFILM surface as `-1` (conflating it with a caller error) and
  `se_get_body_cm` did the same for non-SOAPFILM/non-sdim-3; both now return
  `0`. No behavioural change downstream — the worker already clamped `-1` to an
  empty result — but the API no longer lies about what went wrong.
- **Corrected two `se_api.c` comments** claiming the graphics pipeline is
  "absent in the headless build". It is not: `CMakeLists.txt` links
  `SE_GRAPHICS_COMMON` into `libse` unconditionally and `SE_HEADLESS` only swaps
  `xgraph.c` for `nulgraph.c`. The globals are empty because nothing in the
  facade ever calls `graphgen()` — linked but never invoked. The
  recomputations in `se_get_bounding_box` / `se_get_body_cm` stay, now as a
  deliberate choice rather than a forced one.
- **Dead surface removed across the RPC seam.** All of it was computed,
  transported and typed, but read by nothing: the `setScale` RPC arm and its
  `ScaleResult` type; `vertex_ids` / `body_volumes` / `edge_colors` on
  `MeshData`; `scale` / `sdim` / `vertex_count` / `facet_count` / `edge_count`
  on `SessionState`; and the `[job` / `[ws]` log-line styling left over from
  the removed bun/websocket sidecar. The worker still emits the mesh fields —
  trimming the payload itself is BACKLOG A1 (binary transport), not this.
- **BACKLOG F7** (`runTopo` never passed `n`) closed by removing the unused
  parameter rather than inventing a count. Only `equi` consumed it; `u 5` in
  the CLI covers repeated passes.
- **Lagrange-order warning de-duplicated** into `lagrangeWarning()` in
  `ui/src/api/sessions.ts`; `FilePane` and `EditorPane` had byte-identical
  copies.
- **Re-opening the active file after a cancel** now works — `handleSelect`
  short-circuited on `activeFile === file` even when no live session remained.
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
