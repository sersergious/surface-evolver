# Surface Evolver Engine

This directory contains the original Surface Evolver C source code (~100 files), written by Ken Brakke. It is the computational core of the project and is not modified.

## Structure

| Directory | Contents |
| --- | --- |
| `core/` | Parser, expression evaluator, command interpreter, gradient descent driver |
| `surface/` | Surface physics, topological operations (refine, equiangulate, etc.) |
| `graphics/` | Display backends — X11 (`xgraph.c`) and headless no-op (`nulgraph.c`) |

Header files in `src/` define the global data structures shared across all modules:

| File | Purpose |
| --- | --- |
| `web.h` | Central `web` struct — mesh data, energy, scale, constraints |
| `extern.h` | Global variable declarations |
| `proto.h` | Function prototypes |
| `model.h` | Model type definitions |
| `storage.h` | Memory management |
| `skeleton.h` | Mesh element types (vertex, edge, facet, body) |

## Build

The engine is compiled via CMake into two targets:

- `libse.so` — shared library, used by the Python/FastAPI backend
- `surface_evolver` — standalone CLI binary

```bash
# Headless build (no X11 required)
cmake -B build -DSE_HEADLESS=ON
cmake --build build
```

The `-DSE_HEADLESS=ON` flag links `nulgraph.c` instead of `xgraph.c`, which is required for the server/Docker environment.

## Usage from Other Layers

The engine is not called directly. All access goes through the C API facade in [`bindings/c/se_api.h`](../bindings/c/se_api.h), which exposes 17 functions with output capture and error recovery. The Python wrapper in [`bindings/python/se.py`](../bindings/python/se.py) wraps those via CFFI.
