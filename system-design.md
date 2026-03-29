# Surface Evolver: System Design

## Overview

The project has a working C library (`libse.so`) and a Python CFFI wrapper (`SurfaceEvolver` class in `bindings/python/se.py`). The goal is to expose this as a RESTful HTTP API via FastAPI, add a 3D visualization UI in React, and wire everything together in Docker.

**Critical constraint:** `libse.so` has a single global C state — it is not thread-safe and cannot run multiple simulations simultaneously.

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                    │  Port 3000
│ react-three-fiber · Zustand · React Query · recharts│
└─────────────────────┬───────────────────────────────┘
                      │ HTTP/REST + WebSocket
┌─────────────────────▼───────────────────────────────┐
│                  FastAPI Backend                    │  Port 8000
│ uvicorn · pydantic · python-multipart · asyncio     │
└─────────────────────┬───────────────────────────────┘
                      │ CFFI (ABI mode)
┌─────────────────────▼───────────────────────────────┐
│           Python Wrapper (bindings/python/se.py)    │
│  SurfaceEvolver class · SEError exception           │
└─────────────────────┬───────────────────────────────┘
                      │ dlopen / shared library
┌─────────────────────▼───────────────────────────────┐
│             C API Facade (bindings/c/)              │
│  se_api.h · 17 functions · longjmp error recovery   │
│  open_memstream output capture · signal handlers    │
└─────────────────────┬───────────────────────────────┘
                      │ direct function calls
┌─────────────────────▼───────────────────────────────┐
│          Surface Evolver Core Engine (src/)         │
│  ~100 C files · parser · expression evaluator       │
│  gradient descent · mesh topology · nulgraph backend│
└─────────────────────────────────────────────────────┘
```

---

## Directory Layout

```
surface-evolver/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py              # FastAPI app, CORS, router mounts
│       ├── config.py            # pydantic-settings: SE_LIB_PATH, SE_FE_DIR, ports
│       ├── core/
│       │   ├── se_manager.py    # SE singleton + asyncio.Lock + ThreadPoolExecutor
│       │   ├── session_store.py # In-memory dict: sessionId → SessionState
│       │   └── job_runner.py    # Runs iterate() in batches, emits progress events
│       ├── models/
│       │   ├── session.py       # SessionCreate, SessionResponse, SessionState
│       │   ├── job.py           # JobStatus, JobResult
│       │   ├── mesh.py          # MeshData (vertices, facets, body_volumes)
│       │   └── simulation.py    # IterateRequest, RunCommandRequest
│       ├── routers/
│       │   ├── sessions.py      # POST/GET/DELETE /api/v1/sessions
│       │   ├── files.py         # GET /api/v1/files (bundled .fe files only)
│       │   ├── simulation.py    # POST /sessions/{id}/iterate, POST /sessions/{id}/run
│       │   └── jobs.py          # GET/DELETE /api/v1/jobs/{job_id}
│       └── ws/
│           └── progress.py      # WS /api/v1/ws/sessions/{id}/progress
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/                 # Axios wrappers (client, files, sessions, simulation, jobs)
│       ├── hooks/               # useProgressWS, useMesh
│       ├── store/useStore.ts    # Zustand: sessionId, activeFile, energy, area, outputLog, meshVersion, jobId, jobProgress
│       ├── App.tsx              # Single-page three-pane layout (no routing)
│       └── components/
│           ├── FilePane/        # Left: lists bundled .fe files, click to load
│           ├── CliPane/         # Middle: command input + scrolling output log + stats bar
│           └── ViewerPane/      # Right: react-three-fiber canvas + progress overlay
├── docker-compose.yml           # Production: backend + frontend services
└── docker-compose.dev.yml       # Dev overrides: hot reload for both
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Core engine** | C (C11, ~100 files) | Surface physics, parser, gradient descent |
| **C API** | `se_api.h` / `se_api.c` | 17-function facade, output capture, error recovery |
| **Python binding** | CFFI (ABI mode) | `SurfaceEvolver` class wrapping the 17 C functions |
| **Backend framework** | FastAPI + uvicorn | Async HTTP server, WebSocket support |
| **Backend validation** | Pydantic v2 + pydantic-settings | Request/response schemas, env config |
| **Backend concurrency** | `asyncio.Lock` + `ThreadPoolExecutor(1)` | Serializes SE ops; frees event loop for status polls |
| **File listing** | pathlib (stdlib) | Enumerate bundled `.fe` files from `SE_FE_DIR` |
| **3D rendering** | Three.js + react-three-fiber + drei | WebGL mesh from vertex/facet arrays |
| **Charts** | recharts | Energy-over-iterations line chart |
| **Client state** | Zustand | sessionId, activeFile, energy, area, outputLog, meshVersion, jobId, jobProgress |
| **Server state** | TanStack React Query | API caching, mesh re-fetch on meshVersion bump |
| **HTTP client** | Axios | Frontend → backend calls |
| **Build tool** | Vite + TypeScript | Frontend bundler + dev proxy |
| **Build system** | CMake | Compiles `libse.so` + `surface_evolver` CLI |
| **Containerization** | Docker multi-stage + Compose | Builder → backend → frontend chain |
| **Testing (C)** | Custom CTest harness | 12 tests against `libse.so` |
| **Testing (Python)** | pytest + CFFI | 23+ tests via `SurfaceEvolver` class |
| **Testing (Backend)** | pytest + httpx | Integration tests against FastAPI app |
| **CI** | GitHub Actions | c-tests → python-tests → backend-tests → frontend-tests |

---

## REST API

### Sessions
```
POST   /api/v1/sessions          { "fe_file": "cube.fe" }   (bundled files only)
GET    /api/v1/sessions
GET    /api/v1/sessions/{id}     → energy, area, scale, counts
DELETE /api/v1/sessions/{id}
```

### Files
```
GET    /api/v1/files             → list bundled .fe files (SE_FE_DIR only, no upload)
```

### Simulation (on a session)
```
POST   /api/v1/sessions/{id}/iterate   { "steps": 100 } → { job_id, status: "queued" }
POST   /api/v1/sessions/{id}/run       { "command": "r" } → { output, energy, area }
GET    /api/v1/sessions/{id}/mesh      → { vertices, vertex_ids, facets, body_volumes }
```

### Jobs
```
GET    /api/v1/jobs/{job_id}     → { status, steps_completed, energy_start/end, ... }
DELETE /api/v1/jobs/{job_id}     → cancel (sets threading.Event, polled between batches)
```

### WebSocket
```
WS     /api/v1/ws/sessions/{id}/progress
  Messages: { type: "progress", step, total, energy }
            { type: "completed", energy }
            { type: "error", message }
```

**Lock behavior:** `409 Conflict` (with `Retry-After`) if SE is locked. Long `iterate()` calls run in `ThreadPoolExecutor(max_workers=1)` in batches of ~10 steps, freeing the async event loop for status-check requests.

---

## Concurrency Design

```
SEManager (process singleton)
  _se: SurfaceEvolver          # one global instance
  _lock: asyncio.Lock          # serializes all SE operations
  _executor: ThreadPoolExecutor(max_workers=1)
  _cancel_flag: threading.Event

iterate_async(session_id, steps, progress_cb):
  async with _lock:
    run _run_in_thread() in executor
    _run_in_thread polls _cancel_flag between 10-step batches
    calls asyncio.run_coroutine_threadsafe(progress_cb(...)) for live updates
```

**Session switching:** Only one session is "active" in `libse.so` at a time. Switching sessions triggers `se_load()` again, replacing the current state (in-memory only — no persistence by default). Sessions are tracked in an in-memory dict; state is lost on process restart.

**File selection:** MVP uses only bundled `.fe` files from `SE_FE_DIR` (`/app/fe` in container). `se_load(path)` interprets any `.fe` file at runtime — no recompilation needed.

---

## Docker Infrastructure

```
┌──────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────┐   │
│  │  se-builder  │   │   backend    │   │  frontend   │   │
│  │  (existing   │──▶│  python:3.12 │   │ nginx:alpine│   │
│  │  dockerfile) │   │  port 8000   │◀──│  port 3000  │   │
│  └──────────────┘   └──────────────┘   └─────────────┘   │
│         │                  │                             │
│         └── libse.so ──────┘                             │
│              volumes: uploads/, fe/                      │
└──────────────────────────────────────────────────────────┘
```

The existing `dockerfile` is **unchanged** — it still builds `libse.so` and `surface_evolver`, tagged as `se-builder:latest`. The backend Dockerfile copies `libse.so` and `fe/` out of that image.

**Dev overrides (`docker-compose.dev.yml`):**
- Backend: `uvicorn --reload` + bind-mount `./backend/app` and `./bindings`
- Frontend: Vite dev server on port 5173 with `./frontend/src` bind-mount

---

## 3D Visualization

Vertex + facet arrays from `GET /sessions/{id}/mesh` map directly to `THREE.BufferGeometry`:

```ts
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices.flat()), 3));
geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(facets.flat()), 1));
geometry.computeVertexNormals();
```

---

## What Stays Unchanged

- `bindings/c/se_api.h`, `se_api.c`
- `bindings/python/se.py` — imported directly by `se_manager.py`
- `CMakeLists.txt` and `dockerfile`
- `tests/python/` — all existing tests continue to work
- `fe/` directory — copied into backend container at `/app/fe`

---

## Implementation Order

1. `backend/requirements.txt` + `config.py`
2. `backend/app/models/` (session, mesh, simulation, job)
3. `backend/app/core/session_store.py`
4. `backend/app/core/se_manager.py` — SE singleton + lock (most critical)
5. `backend/app/routers/files.py` + `sessions.py`
6. `backend/app/core/job_runner.py` + `backend/app/ws/progress.py`
7. `backend/app/routers/simulation.py` + `jobs.py`
8. `backend/app/main.py`
9. `backend/Dockerfile`
10. `docker-compose.yml` + `docker-compose.dev.yml`
11. Frontend scaffold (package.json, vite.config.ts, tsconfig.json)
12. `frontend/src/api/` (client, files, sessions, simulation, jobs)
13. `frontend/src/store/useStore.ts`
14. `frontend/src/hooks/` (useProgressWS, useMesh)
15. `frontend/src/components/FilePane/`, `CliPane/`, `ViewerPane/`
16. `frontend/src/App.tsx` + `main.tsx`
17. `frontend/Dockerfile` + `nginx.conf`

---

## CI/CD

Add `backend-tests` job to `.github/workflows/ci.yml` after `python-tests`, downloading the same `libse-so` artifact and running `pytest backend/tests`. The existing `frontend-tests` job activates automatically once `frontend/package.json` exists.
