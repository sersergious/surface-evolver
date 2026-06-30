# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A desktop application that wraps the Surface Evolver C engine in an interactive three-pane UI (file picker → CLI → 3D viewer). The app runs as a native desktop window via **Electrobun** (a Bun-based Electron alternative).

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
bun run dev          # launch Electrobun dev mode (compiles Tailwind CSS then hot-reloads)
bun run build        # production app bundle
```

## Tests

```bash
# C API tests (requires built libse)
ctest --test-dir cmake-build-debug --output-on-failure

# Frontend unit tests (Vitest)
cd src/views && bun run test

# Type-check frontend
cd src/views && bunx tsc --noEmit
```

## Architecture

```
Electrobun desktop app
       ↕ native IPC (Electrobun RPC)
src/main/src/index.ts          ← Electrobun main process entry
       ↕ stdin/stdout JSON
src/main/src/se-worker.ts      ← subprocess, owns one libse instance
       ↕ bun:ffi dlopen
cmake-build-debug/libse.dylib  ← C engine compiled as shared library
       ↕ direct calls
engine/bindings/c/se_api.c     ← C API facade
       ↕ internal calls
engine/src/                    ← Surface Evolver C source (~100 files)
```

### Key design constraint: one worker per session

`libse.so` cannot be initialized twice in the same process — calling `se_init()` a second time causes heap corruption. `se-manager.ts` works around this by spawning a fresh `se-worker.ts` subprocess per session (via `Bun.spawn`). Each subprocess owns exactly one `libse` instance. Loading a new `.fe` file kills the previous worker and spawns a new one.

### IPC protocol (se-worker)

The worker speaks line-delimited JSON on stdin/stdout:
- **stdin** ← `{"cmd":"load"|"run"|"mesh"|"iterate", ...}`
- **stdout** → `{"type":"result","ok":true|false, ...}` or `{"type":"progress","step":N,"total":M,"energy":E}` (iterate only)

Cancellation is done by killing the worker process (SIGTERM); no in-band cancel command.

### Frontend (src/views)

React + Vite app. Four routes rendered in `App.tsx`:
- `/` — three-pane layout: **FilePane** (file picker) + **CliPane** (commands) + **ViewerPane** (Three.js mesh)
- `/docs` — **DocsPage** serving bundled HTML documentation from `src/views/docs/`

State management: `useStore.ts` (**Zustand**) is the single source of truth. `AppContext.tsx` is a thin re-export shim — it re-exports `useStore` as `useAppState` so existing component imports keep working. Native-menu clicks arrive as `CustomEvent('se-menu')` and are routed by `useMenuAction`.

**API client** (`src/views/src/api/client.ts`): maps HTTP-style call paths to Electrobun RPC (`Electroview.rpc.request`). The paths are a naming convention only — there is no HTTP server; every call is native IPC.

CSS is compiled from Tailwind source (`src/styles/global.css`) to `src/styles/compiled.css` via `bun run css` before dev/build.

## Repository Layout

```
surface-evolver/
├── engine/
│   ├── src/                    # Surface Evolver C engine (~100 files)
│   │   ├── core/               # Parser, expression evaluator, command loop
│   │   ├── surface/            # Gradient descent, topology operations
│   │   └── graphics/           # Display backends
│   └── bindings/c/             # se_api.h / se_api.c — C API facade
├── src/
│   ├── main/src/               # Electrobun main process (Bun)
│   │   ├── index.ts            # App entry, IPC RPC handlers
│   │   ├── app-menu.ts         # Native macOS menu bar
│   │   ├── se-manager.ts       # Worker lifecycle + mutex
│   │   ├── se-worker.ts        # Subprocess: owns libse via bun:ffi
│   │   ├── session-store.ts    # In-memory session state
│   │   ├── persistence.ts      # Auto-save/restore last surface
│   │   └── config.ts           # Reads env vars
│   └── views/src/              # React + Vite frontend
│       ├── components/         # FilePane, CliPane, ViewerPane, DocsPage, ...
│       ├── store/
│       │   ├── useStore.ts     # Zustand store — single source of truth
│       │   └── AppContext.tsx   # Re-export shim (useAppState → useStore) + no-op AppProvider
│       ├── api/                # client.ts + per-resource modules
│       ├── hooks/              # useProgressWS, useMesh
│       └── styles/             # global.css (Tailwind source) → compiled.css
├── src/views/docs/             # Bundled SE HTML documentation
├── fe/                         # Bundled .fe datafiles (cube, sphere, ...)
├── tests/c/                    # CTest integration tests for C API
├── electrobun.config.ts        # App bundle config
├── CMakeLists.txt              # Builds surface_evolver CLI + libse shared lib
└── package.json                # Root workspace (src/main + src/views)
```

## Environment / Config

`src/main/src/config.ts` reads these env vars:

| Var | Default | Purpose |
|---|---|---|
| `SE_LIB_PATH` | `cmake-build-debug/libse.dylib` | Path to compiled shared library |
| `SE_FE_DIR` | `fe/` | Directory of `.fe` datafiles |
| `SE_WORKER_PATH` | `src/main/src/se-worker.ts` | Path to the worker script |
| `SE_STATE_DIR` | `~/.surface-evolver` | Session-persistence sidecar dir |
