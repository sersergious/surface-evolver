# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A web UI wrapping the [Surface Evolver](https://facstaff.susqu.edu/brakke/evolver/evolver.html) C engine as a three-pane browser application: file selector → CLI interface → 3D WebGL visualization. The engine minimizes surface energy subject to constraints (volumes, pressures, boundaries) via gradient descent.

## Architecture

```
React Frontend (port 3000 / 5173 dev)
        ↕ HTTP/REST + WebSocket
FastAPI Backend (port 8000)
        ↕ subprocess JSON protocol
SE Worker subprocess (se_worker.py)
        ↕ CFFI ABI mode
Python Wrapper (app/bindings/python/se.py)
        ↕ dlopen
C API Facade (app/bindings/c/se_api.h — 17 functions)
        ↕ direct calls
Surface Evolver C Engine (app/src/)
```

**Critical constraint:** `libse.so` has a single global C state. Calling `se_init()` / `startup()` more than once in the same process causes heap corruption. The backend works around this by spawning a **fresh subprocess** (`se_worker.py`) for each session load, killing the previous one first. `se_manager.py` owns this lifecycle.

The asyncio lock + `ThreadPoolExecutor(1)` in `se_manager.py` serializes all SE operations while keeping the event loop free for status-check requests. A `threading.Event` cancel flag is polled between iteration batches. A locked SE returns `409 Conflict` with `Retry-After`.

Sessions are in-memory only — state is lost on process restart. Idle sessions are evicted after 30 minutes by a background task in `main.py`.

Only bundled `.fe` files from `SE_FE_DIR` (`/app/fe` in container) are served — no user upload.

## Repository Layout

```
app/
  backend/        FastAPI application
  bindings/c/     se_api.h / se_api.c — C API facade (17 functions)
  bindings/python/ se.py — Python CFFI wrapper
  frontend/       React + Vite + Bun application
  src/            Surface Evolver C engine (~100 files)
  tools/          Developer utilities
docker/
  Dockerfile      C builder (produces libse.so + surface_evolver CLI)
  backend/        Backend service Dockerfile
  frontend/       Frontend service Dockerfile + nginx config + entrypoint
  docker-compose.yml
  docker-compose.dev.yml
fe/               Bundled .fe datafiles (cube, sphere, octa, ...)
tests/
  c/              CTest integration tests
  python/         pytest suite (23+ tests)
```

## Build

```bash
# C library only (headless, for testing)
cmake -B build -DSE_HEADLESS=ON
cmake --build build
# Produces: build/libse.so  build/surface_evolver

# Full stack via Docker (production, run from repo root)
docker compose -f docker/docker-compose.yml up

# Dev mode (hot reload)
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up
# Backend: uvicorn --reload, bind-mount app/backend/app and app/bindings
# Frontend: Vite dev server on port 5173, bind-mount app/frontend/src
```

## Tests

```bash
# C API tests (requires built libse.so)
ctest --test-dir build --output-on-failure

# Python wrapper tests
SE_LIB_PATH=build/libse.so SE_FE_DIR=fe pytest tests/python/test_se_api.py -v

# Backend integration tests (FastAPI + httpx)
SE_LIB_PATH=build/libse.so SE_FE_DIR=fe pytest tests/python/test_backend_api.py -v

# Run a single test
pytest tests/python/test_se_api.py::test_name -v

# Frontend tests (from app/frontend/)
cd app/frontend && bun test
cd app/frontend && bunx tsc --noEmit   # type-check only
cd app/frontend && bun run build       # production build
```

Both `SE_LIB_PATH` and `SE_FE_DIR` env vars must be set for Python/backend tests.

**Python path setup for backend tests:** `PYTHONPATH` must include both `app/backend/` (for `from app.*` FastAPI imports) and `app/` (for `from bindings.python.*` CFFI imports). The `tests/python/conftest.py` handles this automatically for local `pytest` runs.

## Key Files

| File | Role |
|---|---|
| `app/bindings/c/se_api.h` | The 17-function C facade — do not change signatures |
| `app/bindings/python/se.py` | `SurfaceEvolver` CFFI class — primary Python interface |
| `app/backend/app/core/se_manager.py` | SE subprocess lifecycle + asyncio lock + cancel |
| `app/backend/app/core/se_worker.py` | The subprocess that owns one `libse.so` instance |
| `app/backend/app/core/session_store.py` | In-memory dict: `sessionId → SessionState` |
| `app/backend/app/core/job_runner.py` | Runs `iterate()` in batches, emits progress events |
| `app/backend/app/main.py` | FastAPI app, CORS, auth (optional HTTP Basic), idle eviction |
| `app/backend/app/config.py` | Pydantic-settings: `SE_LIB_PATH`, `SE_FE_DIR`, `DEMO_PASSWORD`, `MAX_SESSIONS`, CORS |
| `app/frontend/src/store/useStore.ts` | Zustand: `sessionId`, `activeFile`, `energy`, `area`, `outputLog`, `meshVersion`, `jobId`, `jobProgress` |
| `app/frontend/src/App.tsx` | Single-page three-pane layout (no routing) |

## REST API Summary

```
POST/GET/DELETE /api/v1/sessions
GET             /api/v1/files
POST            /api/v1/sessions/{id}/iterate   → { job_id }
POST            /api/v1/sessions/{id}/run        → { output, energy, area }
GET             /api/v1/sessions/{id}/mesh       → { vertices, vertex_ids, facets, body_volumes }
GET/DELETE      /api/v1/jobs/{job_id}
WS              /api/v1/ws/sessions/{id}/progress
GET             /health
```

## CI Pipeline

GitHub Actions: `c-tests → python-tests → backend-tests → frontend-tests`

`libse.so` is built once in `c-tests` and passed as an artifact to all downstream jobs. Frontend job uses `oven-sh/setup-bun@v2` and runs `bun install --frozen-lockfile`.

## Frontend Stack Notes

- **Runtime:** Bun ≥ 1.0 (`engines.bun` in `package.json`); lockfile is `bun.lock`
- **State:** Zustand for client state; TanStack React Query for server state / API caching
- **3D:** react-three-fiber + drei over Three.js; mesh re-fetched when `meshVersion` bumps in the store
- **Build:** Vite + TypeScript; `bun run build` = `tsc && vite build`
- **Tests:** Vitest (`bun test` = `vitest run`)

## Graphics Backend

`SE_HEADLESS=ON` (required for `libse.so`) compiles `app/src/graphics/nulgraph.c` instead of `app/src/graphics/xgraph.c`. Always use headless for library builds — X11 is only for the standalone CLI.
