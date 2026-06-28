# Codebase Scan Results

## Overall Architecture
The `surface-evolver` repository is a monorepo that provides a modern Web UI for the classic Surface Evolver (SE) engine (originally written in C). 

**Tech Stack**:
- **Runtime**: Bun
- **Backend**: Bun-based HTTP/WS server (`app/backend-bun/`)
- **Frontend**: React, Vite, Tailwind CSS, Zustand, React-Three-Fiber (`app/frontend/`)
- **Core Engine**: C Engine compiled to a shared library (`libse.so`) loaded by Bun using FFI (`bun:ffi`).

*(Note: The documentation in `CLAUDE.md` mentions a Python/FastAPI backend, but this has been entirely replaced by the `backend-bun` implementation.)*

## Directory Structure
- `app/backend-bun/`: The Bun backend API server handling sessions, WebSocket progress streaming, and FFI bindings.
  - `src/server.ts`: Entry point for the backend.
  - `src/se-worker.ts`: A spawned subprocess that owns a single `libse.so` instance, handling C engine calls safely.
  - `src/se-manager.ts`: Manages the lifecycle of SE workers.
- `app/frontend/`: The React + Vite frontend application.
  - Features a multi-pane IDE layout (`FilePane`, `CliPane`, `ViewerPane`).
  - Renders 3D geometries using `@react-three/fiber` and `@react-three/drei`.
  - State management handled by `zustand` (`src/store/useStore.ts`).
- `app/src/`: The original C source code of the Surface Evolver engine.
- `app/bindings/c/`: C-level API facade (`se_api.h`, `se_api.c`) to expose the engine safely to FFI.
- `docker/`: Dockerfiles and compose setups for containerized deployment (now referencing `backend-bun` instead of python).
- `fe/`: Bundled surface datafiles (e.g., `cube.fe`, `sphere.fe`) served natively.
- `src/` (root): An alternative or legacy entry point containing a small Bun server + React application (possibly a prototype or playground, distinct from `app/frontend/`).

## Dependency Scan Results
An automated audit of all `import` and `require` statements against `package.json` configurations across the workspace yielded the following:
1. **Root (`/`)**: All imports in `src/` match declared dependencies.
2. **Backend (`app/backend-bun/`)**: Utilizes only Bun/Node native built-ins (`bun`, `bun:ffi`, `fs`, `path`, `crypto`, `readline`). No external `npm` dependencies required or missing.
3. **Frontend (`app/frontend/`)**: All static imports (`react`, `react-router-dom`, `zustand`, `@react-three/fiber`, etc.) correctly map to `package.json` dependencies.

### Resolved Issues
- **Missing Local Dependencies**: While the root `node_modules` were populated, `app/frontend/node_modules` was missing. This indicated that the frontend dependencies were declared but not installed on disk.
- **Fix Applied**: A full `npm install` was executed within `app/frontend/` to successfully hydrate the missing packages, allowing for frontend builds and development.

## Build and Run Commands
- **Backend**: `bun run src/server.ts` (inside `app/backend-bun`)
- **Frontend**: `vite` or `tsc && vite build` (inside `app/frontend`)
- **Docker**: `docker compose -f docker/docker-compose.yml up`
