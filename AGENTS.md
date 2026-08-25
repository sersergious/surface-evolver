# AGENTS.md

Guidance for AI coding agents working in this repository. Vendor-neutral and
canonical — `.claude/CLAUDE.md` points here rather than duplicating it.

## What this is

A desktop app wrapping the **Surface Evolver** C engine (a ~190,000-line
scientific codebase from the 1990s) in an interactive UI: file picker → 3D
viewer → command line. Native window via **Tauri v2** (Rust backend + system
webview).

The ratio matters: roughly 4,000 lines of app code over a 190,000-line vendored
C engine. Most design decisions here are answers to *"how do we not own 190K
lines of 1990s C"*. When something looks over-cautious, that is usually why.

**Scope is deliberately narrow.** This is a geometry viewer, not a physics UI.
The structured physics/named-quantity API was removed on purpose; all of it
stays reachable as raw Surface Evolver commands through `se_run`. See
*Landmine 8*.

## Setup

```bash
# 1. C engine — headless shared library. Required; nothing works without it.
cmake -B cmake-build-release -DCMAKE_BUILD_TYPE=Release -DSE_HEADLESS=ON
cmake --build cmake-build-release

# 2. JS workspaces
bun install

# 3. Run
bun run dev      # tauri dev — stages libse + worker sidecar + CSS, then Vite
bun run build    # → .app + .dmg under src-tauri/target/release/bundle/
```

The build-directory *name* is arbitrary; `-DSE_HEADLESS=ON` is what matters.
This repo currently has two: `cmake-build-release` (headless — what the tests
use) and `build` (`SE_HEADLESS=OFF`, the standalone X11 CLI binary, optional).

Requires: `cmake`, a C toolchain, `rustc`/`cargo`, `bun`. Bun is expected on
PATH — do **not** add it as an npm dependency (see *Landmine 10*).

## Verification gates — run these before claiming done

```bash
# C API tests (needs built libse)
ctest --test-dir cmake-build-release --output-on-failure          # 56 assertions

# Worker sidecar: FFI-signature guard + stdin/stdout smoke tests.
# Without SE_LIB_PATH the smoke tests skip and only the signature guard runs.
cd src-tauri/worker && \
  SE_LIB_PATH=$PWD/../../cmake-build-release/libse.dylib cargo test   # 8 tests

# Rust app
cd src-tauri && cargo check

# Frontend type-check. There are no frontend unit tests; `bun run test` is
# wired to vitest but matches zero files, so CI does not run it.
cd ui && bunx tsc --noEmit
```

The end-to-end claim worth re-checking after engine or worker changes: **all 20
bundled `.fe` datafiles load and produce facets.** Drive the worker directly:

```bash
cargo build --release --manifest-path src-tauri/worker/Cargo.toml
export SE_LIB_PATH=$PWD/cmake-build-release/libse.dylib
for f in fe/*.fe; do
  printf '{"cmd":"load","path":"%s/%s"}\n{"cmd":"mesh"}\n' "$PWD" "$f" \
    | ./src-tauri/worker/target/release/se-worker 2>/dev/null | tail -1 \
    | grep -q '"ok":true' || echo "FAIL $f"
done
```

Driving the worker directly like this is also the fastest way to reproduce any
engine-level bug without going through the UI.

## Architecture

```
React + Vite (ui/)
       ↕ invoke("rpc", { method, params })   ← ONE Tauri command, 13 methods
src-tauri/src/rpc.rs           ← dispatch: sessions, files, persistence
src-tauri/src/worker.rs        ← worker lifecycle + two mutexes
       ↕ line-delimited JSON on stdin/stdout (spawns a sidecar process)
se-worker  (src-tauri/worker/) ← separate Rust crate, 6 commands
       ↕ libloading dlopen
libse-<os>-<arch>.dylib/.so    ← the C engine as a shared library
       ↕ direct calls
engine/bindings/c/se_api.c     ← C API facade, 28 exports  ← OURS
       ↕ internal calls
engine/src/                    ← Surface Evolver upstream, 115 files, flat ← VENDORED
```

**IPC protocol.** stdin takes `{"cmd": …}` — one of `load`, `run`, `mesh`,
`topo`, `vertex_info`, `dump`. stdout returns
`{"type":"result","ok":true|false,…}`, or `{"type":"fatal","error":…}` if
dlopen/`se_init` fails at startup. There is no `iterate` command — the Run menu
sends `g N` through `run`.

**RPC methods** (`rpc.rs`): `getRestore` `listFiles` `createSession` `cancel`
`uploadFile` `exportDmp` `exportFe` `updateFile` `saveExport` `runCommand`
`getMesh` `vertexInfo` `topo`.

**Frontend.** No router. `App.tsx` renders four panes — FilePane (open files +
browser modal), EditorPane (CodeMirror `.fe` editor), ViewerPane (Three.js
mesh), CliPane (commands + output log). `ui/src/store/useStore.ts` (Zustand) is
the single source of truth. Native menu clicks arrive as a Tauri `se-menu`
event, re-dispatched in `client.ts` as `CustomEvent('se-menu')`, routed by
`useMenuAction`. Hooks: `useMesh`, `useMenuAction`, `useThemeColors`.

---

## Landmines

Non-obvious constraints. Each one has cost someone real time.

### 1. `libse` cannot be initialised twice in one process

Calling `se_init()` a second time causes **heap corruption**. This is why there
is a sidecar process at all: each `se-worker` owns exactly one `libse`. Loading
a new file kills the previous worker and spawns a fresh one.

`worker.rs` uses two mutexes on purpose — `io` for request/response, `proc` for
the process handle. `kill()` takes only `proc`, so it can terminate a worker
that is blocked holding `io`. That is the *only* escape from a hung `se_run`.
**Do not merge these mutexes.**

A *failed* load kills its worker and clears the session: engine state after a
failed `se_load` is undefined.

### 2. `engine/src/` is vendored upstream — never reformat it

Only `engine/bindings/c/` is ours. An IDE reformat of `web.h` once produced a
356-line diff that `git diff -w` reduced to five cosmetic lines. There is
deliberately **no `.clang-format`**: one tuned to 1990s SE style would start
reformatting the other 114 files. If your editor formats on save, exclude
`engine/src/`.

### 3. `src-tauri/worker/` is NOT a Cargo workspace member

It lives inside `src-tauri/` but carries a bare `[workspace]` table to stay
standalone. Two reasons, the second decisive:

- A workspace root would relocate `src-tauri/target/`, which CI artifact paths
  and Tauri's bundle output hard-code.
- **Cargo ignores `[profile]` in workspace members.** Per-package overrides can
  carry `opt-level`/`codegen-units`/`strip` but **not `lto` or `panic`**. A
  shared workspace would force `panic = "abort"` onto the Tauri app — a
  panicking RPC would kill the whole application instead of returning `Err`, and
  `worker.rs`'s mutex-poison recovery would become dead code. The 345 KB sidecar
  depends on exactly those settings.

The worker must **never** depend on `tauri`. Its only deps are `libloading` and
`serde_json`.

### 4. `ffi.rs` must stay in lockstep with `se_api.h`

`src-tauri/worker/src/ffi.rs` declares unchecked `unsafe extern "C"` signatures.
A mismatch is **undefined behaviour, not a compile error**.

`src-tauri/worker/tests/ffi_signatures.rs` guards this **bidirectionally** — it
fails if either side has a function the other lacks, so a half-finished API
change cannot pass. Two known blind spots: any pointer that is not `double*` or
`char*` is assumed `int*`, and `*const` vs `*mut` is decided by a substring
search for `"const"` in the parameter text.

### 5. Mesh buffers are always stride 3

`se_get_vertices` (and `se_get_vertex_info`'s `out_xyz`) writes a **fixed 3
doubles per vertex**, zero-padding beyond `sdim` and truncating above it — *not*
`sdim` components. Size buffers by `count * 3`. Sizing from `sdim` overflows the
heap on 2-D files.

### 6. Return-value convention in the C facade

Documented at the top of `se_api.h` and applied uniformly:

| value | meaning |
|---|---|
| `-1` | bad arguments, or a genuine failure |
| `0` | "not applicable to this surface" — **not** an error |
| `>0` | number of elements written |

### 7. Only the SOAPFILM model is supported

`se_load` **rejects** `STRING` and `SIMPLEX_REPRESENTATION` datafiles with an
`se_last_error()` message. STRING facets are arbitrary polygons and SIMPLEX
cells are k-simplices; `se_get_facets` can express neither, so those files used
to render as a bare edge web or nothing at all. Rejecting beats drawing a lie.
The per-accessor SOAPFILM guards remain as a safety net for callers driving the
engine another way.

**Periodicity is handled by omission.** `se_get_edge_wraps` reports each edge's
wrap code in `se_get_edges` row order; the worker drops wrapped edges and
reports `wrapped_edges_hidden`, which the viewer surfaces in its stat badge.
Gate on `web.symmetry_flag`, **not** `web.torus_flag` — `E_WRAP_ATTR` only gets
storage when a symmetry group is in effect (`engine/src/lexinit.c:2481`), so
reading it on a plain surface would read a zero-length slot.

This is read-only. SE's `detorus` genuinely unwraps geometry but is
**irreversible** (`tordup.c:1546` wipes the flags and period expressions), so it
stays a `run` escape hatch — never something the renderer does silently.

### 8. `se_run` is the escape hatch — do not remove it

The structured physics/named-quantity API was deliberately cut (C exports 37 →
28, worker 10 → 6 commands, two UI panels deleted). **No capability was lost**:
`set gravity_constant 980`, `print body[1].volume`, and `v` (lists every named
quantity with target and actual value) all still work from the CLI pane.

That is what makes aggressive trimming safe. Delete the CLI and every past and
future cut becomes irreversible capability loss. Also note `appendLog` is
currently the app's **only** error channel.

### 9. No progress events; cancel means kill

`{"type":"progress",…}` is reserved but **nothing emits it**. `se_run` is a
blocking FFI call and the worker handles requests serially, so `g 1000` returns
one result and nothing in between. Chunking on the caller side is the only way
to get intermediate feedback.

Cancellation kills the worker process. The in-memory surface dies with it; the
last auto-snapshot survives on disk.

### 10. Build scripts run under Bun Shell

`scripts/*.ts` use Bun Shell (`$`), whose cross-platform builtins are only:
`cd ls rm echo pwd bun cat touch mkdir which mv exit true false yes seq dirname
basename`. Anything else falls through to PATH — notably **`cp` does not exist
on Windows**, and this is invisible on macOS/Linux. Use `node:fs`
(`copyFileSync`, `mkdirSync`) instead of shelling out.

Bun itself must come from PATH or CI's `oven-sh/setup-bun`. Do **not** add `bun`
to `dependencies` — that pulls a ~90 MB platform binary and undoes the entire
point of the Rust sidecar port.

### 11. Generated files that must not be committed

`ui/src/styles/compiled.css` is Tailwind output, regenerated by
`scripts/tauri-before.ts` on every dev and build run. It is gitignored. Same for
`src-tauri/binaries/`, `src-tauri/gen/`, and both `target/` directories.

---

## Repository layout

```
surface-evolver/
├── engine/
│   ├── src/                    # Surface Evolver upstream — VENDORED, never reformat
│   ├── bindings/c/             # se_api.h / se_api.c — the C facade (ours)
│   └── tools/callgraph.py      # standalone analysis tool; wired into no build
├── src-tauri/                  # ALL Rust lives here
│   ├── src/{main,rpc,worker,menu}.rs
│   ├── worker/                 # se-worker sidecar — SEPARATE crate (see Landmine 3)
│   │   ├── src/{main,ffi,handlers}.rs
│   │   └── tests/{ffi_signatures,smoke}.rs
│   ├── capabilities/           # Tauri ACL
│   └── tauri.conf.json
├── ui/src/
│   ├── components/             # FilePane, EditorPane, ViewerPane, CliPane
│   ├── store/useStore.ts       # Zustand — single source of truth
│   ├── api/                    # client.ts (rpc wrapper) + per-resource modules
│   └── hooks/                  # useMesh, useMenuAction, useThemeColors
├── fe/                         # 20 bundled .fe datafiles + OCTA.WLF
├── tests/c/test_se_api.c       # CTest suite for the C facade
├── scripts/                    # build-native, tauri-before, make-icons (Bun)
├── BACKLOG.md                  # ranked work + foam and architecture audits
└── CHANGELOG.md                # per-release notes (Conventional Commits)
```

`fe/OCTA.WLF` is the bundle's only cross-file dependency — `crystal.fe` loads it
via `Wulff "octa.wlf"`. Note the case mismatch; it works on case-insensitive
filesystems and would fail on Linux.

## Environment variables

Paths resolve automatically in `rpc.rs`. These are explicit overrides only:

| Var | Purpose |
|---|---|
| `SE_LIB_PATH` | Compiled shared library (`libse.dylib` / `.so`) |
| `SE_FE_DIR` | Directory of bundled `.fe` datafiles |
| `SE_WORKER_PATH` | Worker sidecar binary |
| `SE_STATE_DIR` | Session-persistence dir (default `~/.surface-evolver`) |

Uploads and editor saves go to `~/.surface-evolver/fe/`; user files shadow
bundled ones of the same name, because the bundled `fe/` may be read-only in a
packaged app.

## Conventions

- **Commits**: Conventional Commits. `CHANGELOG.md` is per-release and
  user-facing — dev-tooling churn does not belong in it.
- **`BACKLOG.md`** carries the ranked work plus two measured audits (foam/
  cellular models, and architecture). Findings there are *measured*, not
  estimated — keep it that way, and mark items resolved rather than deleting
  them.
- **Prefer deleting to adding.** Several rounds of trimming got this codebase to
  its current size; the `se_run` escape hatch is what makes that safe.
- **Update the docs in the same change.** This repo has repeatedly shipped
  stale documentation — numbers in `CHANGELOG.md`/`BACKLOG.md`/this file are
  load-bearing for the next agent.

## Where to look next

- `BACKLOG.md` — what is known-broken, what was assessed and deliberately not
  built, and the two measured audits. Read before proposing work.
- `CHANGELOG.md` — recent changes with rationale.
- `engine/bindings/c/se_api.h` — the entire C surface, 28 functions, documented.
- Official Surface Evolver manual: <https://kenbrakke.com/evolver/html/evolver.htm>
