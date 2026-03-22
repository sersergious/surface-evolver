# Surface Evolver

A web-based interface for the [Surface Evolver](https://facstaff.susqu.edu/brakke/evolver/evolver.html) geometric simulation engine, exposing it as an interactive three-pane application.

## What It Does

Surface Evolver minimizes the energy of surfaces subject to constraints — volumes, pressures, boundary conditions — using gradient descent and other methods. It is widely used in physics, materials science, and computational geometry.

This project wraps the C engine in a REST API and a browser UI so simulations can be run and visualized interactively without touching the command line.

## Architecture

### UI Layout

```
┌─────────────────┬────────────────────┬─────────────────────┐
│   File Selector │   CLI Interface    │   3D Visualization  │
├─────────────────┼────────────────────┼─────────────────────┤
│  [cube.fe]      │  > g 5             │                     │
│  [octa.fe]      │  Energy: 2.45      │   [WebGL mesh]      │
│  [mound.fe]     │  > r               │   [OrbitControls]   │
└─────────────────┴────────────────────┴─────────────────────┘
```

### System Architecture

```
React Frontend (port 3000)
        ↕ HTTP/REST + WebSocket
FastAPI Backend (port 8000)
        ↕ CFFI (ABI mode)
Python Wrapper (bindings/python/se.py)
        ↕ dlopen
C API Facade (bindings/c/se_api.h — 17 functions)
        ↕ direct calls
Surface Evolver Engine 
```

## Stack

| Layer | Technology |
|---|---|
| Core engine | C — parser, gradient descent, mesh topology |
| C API | `bindings/c/se_api.h` — 17-function facade with output capture |
| Python binding | CFFI ABI mode — `SurfaceEvolver` class in `bindings/python/se.py` |
| Backend | FastAPI + uvicorn, Pydantic v2, asyncio + ThreadPoolExecutor(1) |
| 3D rendering | Three.js + react-three-fiber + drei |
| Frontend state | Zustand + TanStack React Query |
| Build | CMake (`libse.so` + `surface_evolver` CLI) |
| Containers | Docker multi-stage + Compose |

## Repository Layout

```
surface-evolver/
├── src/                    # Surface Evolver C engine (~100 files)
│   ├── core/               # Parser, expression evaluator, command loop
│   ├── surface/            # Gradient descent, topology operations
│   └── graphics/           # Display backends (X11 + headless)
├── bindings/
│   ├── c/                  # se_api.h / se_api.c — C facade
│   └── python/             # se.py — Python CFFI wrapper
├── fe/                     # Bundled .fe datafiles (cube, sphere, octa, ...)
├── tests/
│   ├── c/                  # CTest integration tests
│   └── python/             # pytest suite (23+ tests)
├── backend/                # FastAPI application
├── frontend/               # React + Vite application
├── dockerfile              # Builds libse.so and surface_evolver binary
├── docker-compose.yml      # Production: backend + frontend
└── docker-compose.dev.yml  # Dev: hot reload for both services
```

## Quick Start

```bash
# Build and run everything
docker compose up

# Frontend: http://localhost:3000
# Backend API: http://localhost:8000/docs
```

### Dev mode (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Build the C library only

```bash
cmake -B build -DSE_HEADLESS=ON
cmake --build build
```

### Run tests

```bash
# Python tests (requires built libse.so)
pytest tests/python/

# C tests
ctest --test-dir build
```

## Data Files

`.fe` files in `fe/` define the geometry, constraints, and initial conditions for a simulation. Pick one from the UI to load it into the engine. Example files include `cube.fe`, `sphere.fe`, `octa.fe`, `mound.fe`, `knotty.fe`, and more.
