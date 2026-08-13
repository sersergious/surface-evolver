# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A desktop application that wraps the Surface Evolver C engine in an interactive three-pane UI (file picker → CLI → 3D viewer). The app runs as a native desktop window via **Tauri v2** (Rust backend + system webview).

## Build Commands

### C Engine (libse)
```bash
# Headless shared library (required for the app to work)
cmake -B cmake-build-debug -DSE_HEADLESS=ON
cmake --build cmake-build-debug

# With X11 graphics (for the standalone CLI binary)
cmake -B build
cmake --build build
```

### Desktop App
```bash
bun install          # from repo root — installs workspaces
bun run dev          # tauri dev (beforeDevCommand stages native lib + worker + CSS, runs Vite)
bun run build        # tauri build → .app + .dmg under src-tauri/target/release/bundle/
```

## Tests

```bash
# C API tests (requires built libse)
ctest --test-dir cmake-build-debug --output-on-failure

# Type-check frontend  (there are no frontend unit tests yet — `bun run test`
# is wired to vitest but matches zero files, so CI does not run it)
cd ui && bunx tsc --noEmit

# Rust backend
cd src-tauri && cargo check

# Worker sidecar: FFI-signature guard + stdin/stdout smoke tests.
# Needs a built libse; without SE_LIB_PATH the smoke tests skip and only the
# signature guard runs.
cd src-tauri/worker && SE_LIB_PATH=$PWD/../../cmake-build-debug/libse.dylib cargo test
```

## Architecture

```
Tauri desktop app (Rust)
       ↕ invoke("rpc", { method, params })   ← single Tauri command
src-tauri/src/rpc.rs           ← dispatch: sessions, files, persistence
src-tauri/src/worker.rs        ← worker lifecycle + mutexes
       ↕ stdin/stdout JSON (spawns sidecar binary)
se-worker (Rust sidecar, src-tauri/worker/)
       ↕ libloading dlopen
libse-<os>-<arch>.dylib/.so    ← C engine compiled as shared library
       ↕ direct calls
engine/bindings/c/se_api.c     ← C API facade
       ↕ internal calls
engine/src/                    ← Surface Evolver C source (~100 files, flat)
```

### Key design constraint: one worker per session

`libse.so` cannot be initialized twice in the same process — calling `se_init()` a second time causes heap corruption. `worker.rs` works around this by spawning a fresh `se-worker` sidecar process per session. Each subprocess owns exactly one `libse` instance. Loading a new `.fe` file kills the previous worker and spawns a new one. A hung worker is killed *before* taking the I/O mutex so a blocked command can't deadlock the next load. A *failed* load kills its worker and clears the active session (engine state after a failed `se_load` is undefined).

### Session restore & persistence

`rpc.rs` snapshots the surface (SE `dump`) after every mutating command and
restores it lazily on the first `getRestore` call. Two guards keep restore from
clobbering a user-initiated load that happens first: `try_restore` bails if any
session already exists, and `createSession` marks the restore memo consumed.
(The UI has a matching guard in `FilePane`.) `persist()` runs on a background
thread — the dump round-trip is MBs on a refined mesh and must not add latency
to the command path; it still serialises against other worker I/O via the
manager's io mutex.

### IPC protocol (se-worker)

The worker speaks line-delimited JSON on stdin/stdout:
- **stdin** ← `{"cmd": …}`, one of: `load`, `run`, `mesh`, `topo`,
  `vertex_info`, `dump`
  (there is **no** `iterate` command — the Run menu's Iterate sends `g N` via `run`)

  The physics/named-quantity commands (`settings`, `set_settings`,
  `quantities`, `set_scale`) were cut in the Tier C trim, along with the 10 C
  accessors behind them (`se_api.h` 37 → 27; Tier B then added
  `se_get_edge_wraps`, so the facade now exports 28). **None of that capability is
  gone** — gravity, pressure, mesh thresholds, scale and quantity listings are
  all still reachable as SE commands through `run`, which is the whole point of
  keeping `se_run` as an escape hatch. What went away is the *structured* API
  and the two UI panels that read it.
- **stdout** → `{"type":"result","ok":true|false, ...}`, or `{"type":"fatal","error":…}`
  if dlopen/`se_init` fails at startup

`{"type":"progress", ...}` is reserved but **nothing emits it**: `se_run` is a
blocking FFI call and the worker handles requests serially, so a long run
(`g 1000`) returns one result and nothing in between. Chunking on the caller
side is the only way to get intermediate feedback. See BACKLOG "Skip".

Cancellation is done by killing the worker process (SIGTERM); no in-band cancel command.

The sidecar is a standalone Rust binary built from `src-tauri/worker/`. It is
staged at `src-tauri/binaries/se-worker-<triple>` by `scripts/tauri-before.ts`
and bundled via Tauri `externalBin` next to the app executable. It depends only
on `libloading` + `serde_json`; it must never depend on `tauri`.

**It lives inside `src-tauri/` but is deliberately NOT a workspace member**, and
carries a bare `[workspace]` table to keep it that way. Two reasons, the second
decisive: a workspace root would relocate `src-tauri/target/`, which CI paths
and tauri's bundle output hard-code; and **Cargo ignores `[profile]` in
workspace members**. Per-package overrides can carry `opt-level`/
`codegen-units`/`strip` but *not* `lto` or `panic`, so sharing a workspace
would force `panic = "abort"` onto the Tauri app — a panicking RPC would kill
the whole application instead of returning `Err`, and `worker.rs`'s mutex
poison recovery would become dead code. The 345 KB sidecar depends on exactly
those settings.

`src-tauri/worker/src/ffi.rs` must stay in lockstep with `engine/bindings/c/se_api.h`:
the signatures there are unchecked `unsafe extern "C"` declarations, so a
mismatch is undefined behaviour rather than a compile error. Unlike the old
bun:ffi table, a *missing* symbol is caught per-symbol at startup and named in
the `{"type":"fatal"}` message.

Historical note: the sidecar used to be a 58 MB bun-compiled binary
(`worker/se-worker.ts`, bun:ffi). bun 1.3.14 emitted layouts that failed
`codesign` strict validation outright, which broke the macOS bundle build and
forced a strip/re-sign step plus `--bytecode`. The Rust port removed the
sidecar's 58 MB, the codesign workaround, and the bun runtime dependency in one
go. Don't reintroduce a bun-compiled sidecar without re-reading that history.

### Mesh API limits (bites more than you'd expect)

`se_get_vertices` (and `se_get_vertex_info`'s `out_xyz`) always writes a **fixed
stride of 3** doubles per vertex, zero-padding beyond `sdim` and truncating
above it — *not* `sdim` components. Size buffers by `count * 3`. The header used
to say otherwise; sizing from the old wording under-allocates on the `sdim=2`
foam files and overflows the heap.

`se_get_facets` is **SOAPFILM-only** — STRING (2-D) and SIMPLEX models return 0
facets. As of the Tier A trim, `se_load` **rejects** both models outright with
an `se_last_error()` message, so that path is no longer reachable through the
app: STRING facets are arbitrary polygons and SIMPLEX cells are k-simplices,
neither of which the triangle accessor can express, and rendering them as a
bare edge web was drawing a lie. The guards stay as a safety net for callers
that drive the engine some other way.
Several other accessors are gated the same way or on `sdim == 3`
(`se_get_facet_colors`, `se_get_body_cm`). They used to disagree on the failure
value; the facade now has one convention, documented at the top of `se_api.h`:
**`-1` = bad arguments or genuine failure, `0` = "not applicable to this
surface", `>0` = elements written.**

**Periodicity is handled, by omission.** `se_get_edge_wraps` (added in Tier B)
reports each edge's wrap code in `se_get_edges` row order, and the worker drops
wrapped edges from the mesh rather than draw them as lines spanning the domain.
The mesh response carries `wrapped_edges_hidden` when anything was dropped, and
ViewerPane shows it in the stat badge so the omission is visible.

The gate is `web.symmetry_flag`, **not** `web.torus_flag`: `E_WRAP_ATTR` only
gets storage from `expand_attribute(EDGE,…)` when a symmetry group is in effect
(`engine/src/lexinit.c:2481`), so reading `get_edge_wrap()` on a plain surface
would read a zero-length attribute slot. The accessor returns 0 there.

This is read-only — nothing is mutated. SE's `detorus` genuinely unwraps the
geometry but is **irreversible** (it wipes `torus_flag`, `symmetry_flag` and the
period expressions, `tordup.c:1546`), so it stays a `run` escape hatch, not
something the renderer does behind your back.

Measured after the change: `phelanc.fe` 103 of 368 edges hidden, remaining
max/median edge length 1.49; `symtest.fe` and `twointor.fe` 41 hidden each,
max/median 1.00. See the "Foam / cellular models" audit in `BACKLOG.md`.

### Frontend (ui)

React + Vite app, no router. `App.tsx` renders one four-pane layout:
**FilePane** (open files + browser modal) + **EditorPane** (CodeMirror .fe editor)
+ **ViewerPane** (Three.js mesh) + **CliPane** (commands + output log).

State management: `useStore.ts` (**Zustand**) is the single source of truth; components import `useStore` directly. Native-menu clicks (built in `src-tauri/src/menu.rs`) arrive as a Tauri `se-menu` event, re-dispatched in `client.ts` as `CustomEvent('se-menu')` and routed by `useMenuAction`.

**API client** (`ui/src/api/client.ts`): exports `rpc(method, params)` — a thin wrapper over Tauri `invoke("rpc", …)`. Per-resource modules call Rust-side methods (dispatched in `rpc.rs`) by name. There is no HTTP server.

CSS is compiled from Tailwind source (`src/styles/global.css`) to `src/styles/compiled.css` via `bun run css` (part of `scripts/tauri-before.ts`).

## Repository Layout

```
surface-evolver/
├── engine/
│   ├── src/                    # Surface Evolver C engine (~117 files, flat upstream layout)
│   │                           # VENDORED — never reformat; see note below
│   └── bindings/c/             # se_api.h / se_api.c — C API facade
├── src-tauri/                  # Tauri (Rust) backend — ALL Rust lives here
│   ├── src/main.rs             # App entry: window, menu, state
│   ├── src/rpc.rs              # RPC dispatch (sessions, files, persistence)
│   ├── src/worker.rs           # Worker lifecycle + mutexes
│   ├── src/menu.rs             # Native menu bar
│   ├── worker/                 # se-worker sidecar — SEPARATE crate, not a
│   │   │                       # workspace member (own target/ + release profile)
│   │   └── src/{main,ffi,handlers}.rs  # stdin loop / libse FFI / handlers
│   ├── capabilities/           # Tauri ACL (drag-region, events, opener)
│   ├── binaries/               # se-worker-<triple> sidecar (gitignored, staged by scripts)
│   └── tauri.conf.json         # Bundle config (resources, externalBin, window)
├── ui/                         # React + Vite frontend
│   └── src/
│       ├── components/         # FilePane, EditorPane, CliPane, ViewerPane, ...
│       ├── store/useStore.ts   # Zustand store — single source of truth
│       ├── api/                # client.ts (rpc wrapper) + per-resource modules
│       ├── hooks/              # useMesh, useQuantities, useMenuAction, useThemeColors
│       └── styles/             # global.css (Tailwind source) → compiled.css
├── fe/                         # Bundled .fe datafiles (cube, sphere, ...)
├── tests/c/                    # CTest integration tests for C API
├── scripts/tauri-before.ts     # beforeDev/BuildCommand: libse + worker sidecar + CSS
├── BACKLOG.md                  # ranked work + the foam and architecture audits
├── CHANGELOG.md                # per-release notes (Conventional Commits)
├── CMakeLists.txt              # Builds surface_evolver CLI + libse shared lib
└── package.json                # Root workspace (ui)
```

**`engine/src/` is vendored upstream — do not reformat it.** Only
`engine/bindings/c/` is ours. An IDE reformat of `web.h` once produced a
356-line diff that `git diff -w` reduced to five cosmetic lines (blank lines
plus a brace moved to its own line); churn like that buys nothing and makes
future upstream diffs harder to read. There is deliberately no `.clang-format`
here: one tuned to 1990s SE style would start reformatting the other 116 files.
If your IDE reformats on save, exclude `engine/src/`.

### Build scripts (`scripts/*.ts`)

They run under Bun Shell (`$`), whose cross-platform builtins are only
`cd ls rm echo pwd bun cat touch mkdir which mv exit true false yes seq dirname
basename`. Anything else falls through to PATH — notably **`cp` does not exist
on Windows**, and this is invisible on macOS/Linux. Use `node:fs`
(`copyFileSync`, `mkdirSync`) for file operations instead of shelling out.
`sips` in `make-icons.ts` is macOS-only by design and is not part of the build.

## Environment / Config

Paths resolve automatically in `rpc.rs`: the native lib and fe/ live in the
bundle's resource dir; the se-worker sidecar sits next to the app executable
(both in dev and packaged). Env vars are explicit overrides only:

| Var | Purpose |
|---|---|
| `SE_LIB_PATH` | Path to compiled shared library (libse.dylib / libse.so) |
| `SE_FE_DIR` | Directory of bundled `.fe` datafiles |
| `SE_WORKER_PATH` | Path to the worker sidecar binary |
| `SE_STATE_DIR` | Session-persistence sidecar dir (default `~/.surface-evolver`) |

Uploads and editor saves go to `~/.surface-evolver/fe/` (user files shadow
bundled ones of the same name) — the bundled fe/ dir may be read-only in a
packaged app.
