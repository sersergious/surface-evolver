# Surface Evolver

A native **desktop app** for Mac, Linux, and Windows that wraps the [Surface Evolver](https://facstaff.susqu.edu/brakke/evolver/evolver.html) C engine in an interactive three-pane interface: a file browser, a command line, and a live 3D viewer. It runs as a real desktop window via [Tauri](https://tauri.app/) (Rust backend + system webview) — no browser, no server, no HTTP.

## What it does

Surface Evolver minimizes the energy of surfaces subject to constraints — volumes, pressures, boundary conditions — using gradient descent and other methods. It's widely used in physics, materials science, and computational geometry.

This project drives the original C engine directly through `bun:ffi`, so you get the full Surface Evolver command language in the CLI pane, plus first-class UI for the common workflow (load → evolve → refine → inspect → export) and a WebGL viewer that renders the mesh as it evolves.

## What you can do

- **Load** any bundled `.fe` file, or upload your own (the **+** button in the file pane). Open several as tabs.
- **Run the full SE command language** in the CLI pane — anything you'd type in the real Evolver (`g`, `r`, `u`, `hessian`, `ritz`, quantity/constraint definitions, macros like `gogo := { … }`, …).
- **Evolve & refine** via the Run menu / keyboard: iterate (`⌘G`), Refine (`⌘R`), Equiangulate (`⌘U`), Vertex Average (`⌘E`), Pop.
- **Visualize** in 3D: Solid / Wireframe / X-Ray modes, native SE per-element colours, full edge overlay, orbit + reset camera.
- **Inspect**: click a vertex for its id, coordinates, constraints and flags; body centre-of-mass markers.
- **Panels**: named quantities + energy breakdown; mesh-quality and physics settings (min area/length, gravity, pressure).
- **Export** the current surface as `.fe` or an exact-state `.dmp`.
- **Auto-restore** — your evolved surface comes back after a restart.

## What you can't do (yet)

- **Only one live session at a time.** The engine is one-worker-per-session, so open files are tabs — switching reloads; background tabs aren't kept warm.
- **Power features are CLI-only** (they work, just no buttons): Hessian/eigenvalue stability analysis, and advanced ops like `edgeswap`, `dissolve`, `jiggle`, `optimize`, `conj_grad`, `saddle`.
- **Defining** quantities / constraints / methods happens in the CLI or the `.fe` file — the panels are view-only.
- **No scalar heat-map colormaps** (curvature/valence/…); the viewer shows native SE colours only.
- **No native graphics window or PostScript export** — the WebGL viewer replaces them.

## Known issues

- **`simplex3.fe` and `slidestr.fe` are hidden** — `simplex3` (SIMPLEX model) loads and runs but renders empty (simplex cells aren't exposed by the mesh API); `slidestr` is a malformed bundled datafile the engine rejects at load.
- **Curved (Lagrange/quadratic) patches render as straight edges** — you'll see a warning in the log; the geometry is approximate.
- **Attributes defined in a datafile's *command* section** don't appear in the colour/inspector lists until the file is reloaded (header-defined attributes are fine).
- **Closing the active tab clears the viewer** — it doesn't auto-switch to another open file.
- **Distributables are ad-hoc signed, not notarized** — on first open macOS warns it "cannot verify the app is free of malware": right-click → Open, or `xattr -dr com.apple.quarantine "/Applications/Surface Evolver.app"`.

## Overall architecture

One worker subprocess owns exactly one `libse` instance per session — `libse` can't be initialized twice in the same process, so loading a new file spawns a fresh worker.

```mermaid
flowchart TD
    subgraph win["Tauri desktop window"]
        UI["React + Three.js views<br/>FilePane · Editor/CLI · 3D Viewer"]
    end
    UI <-->|"Tauri invoke — rpc(method, params)"| Main["Rust backend<br/>src-tauri/src/rpc.rs"]
    Main -->|"spawn per session"| Mgr["worker.rs<br/>worker lifecycle + mutex"]
    Mgr <-->|"line-delimited JSON<br/>over stdin/stdout"| Worker["se-worker sidecar<br/>owns one libse instance"]
    Worker <-->|"bun:ffi dlopen"| Lib["libse<br/>(headless shared library)"]
    Lib --> Engine["Surface Evolver C engine<br/>engine/src — ~117 files"]
    Main -->|"auto-snapshot / restore"| Persist["last-session.json<br/>~/.surface-evolver"]
```

## API architecture

The frontend "API client" uses HTTP-style call paths purely as a naming convention — every call is native IPC, not a network request. A request threads through five layers down to the C facade and back:

```mermaid
flowchart LR
    View["client.ts<br/>rpc(method, params)"] -->|"Tauri invoke"| RPC["RPC dispatch<br/>src-tauri/src/rpc.rs"]
    RPC --> Mgr["worker.rs<br/>mutex-serialized"]
    Mgr -->|"cmd: load · run · mesh · topo …"| Worker["se-worker sidecar"]
    Worker -->|"bun:ffi"| Facade["se_api.c / se_api.h<br/>C facade (~50 functions)"]
    Facade --> Core["engine/src<br/>parser · command loop"]
    Facade --> Surf["engine/src<br/>gradient descent · topology"]
```

The C facade (`engine/bindings/c/se_api.h`) exposes structured getters/setters — geometry (vertices/edges/facets/normals), energy/area, quantities + energy methods, physics, mesh params, body volumes + centre-of-mass, per-vertex scalar fields, constraints, attributes — plus a universal `se_run` escape hatch that gives the CLI pane the entire command language. Graphics-only engine globals excluded from the headless build (bounding box, normals, body CM) are recomputed inside the facade.

## Stack

| Layer | Technology |
|---|---|
| Core engine | C — parser, gradient descent, mesh topology (~117 files, flat upstream layout) |
| C API | `engine/bindings/c/se_api.{h,c}` — ~50-function facade with stdout/stderr capture |
| Native binding | `bun:ffi` `dlopen` in a bun-compiled worker sidecar |
| Desktop shell | Tauri v2 (Rust, native WKWebView / WebKitGTK / WebView2) |
| 3D rendering | Three.js + @react-three/fiber + drei |
| Frontend | React + Vite, Zustand store, Tailwind + daisyUI, heroicons |
| Build | CMake (`libse` shared lib + `surface_evolver` CLI); Tauri bundler |

## Repository layout

```
surface-evolver/
├── engine/
│   ├── src/                    # Surface Evolver C engine
│   │                           # (flat upstream layout, ~117 files)
│   └── bindings/c/             # se_api.h / se_api.c — C facade
├── src-tauri/                  # Tauri (Rust) backend
│   ├── src/main.rs             # App entry: window, menu, state
│   ├── src/rpc.rs              # RPC dispatch (sessions, files, persistence)
│   ├── src/worker.rs           # Worker lifecycle + mutex
│   ├── src/menu.rs             # Native menu bar
│   └── tauri.conf.json         # Bundle config (resources, sidecar, window)
├── worker/se-worker.ts         # Worker: owns libse via bun:ffi (ships bun-compiled)
├── ui/src/                     # React + Vite frontend
│   ├── components/             # FilePane, CliPane, EditorPane, ViewerPane
│   ├── store/                  # Zustand store (single source of truth)
│   └── api/                    # RPC client + per-resource modules
├── fe/                         # Bundled .fe datafiles (cube, sphere, octa, …)
├── tests/c/                    # CTest integration tests for the C API
├── scripts/tauri-before.ts     # Stages libse + worker sidecar + CSS (dev/build hook)
├── CMakeLists.txt              # Builds surface_evolver CLI + libse shared lib
└── .github/workflows/build.yml # macOS + Linux + Windows build matrix
```

## Build & run

```bash
# 1. Build the headless C library (required)
cmake -B cmake-build-debug -DSE_HEADLESS=ON
cmake --build cmake-build-debug

# 2. Install workspaces
bun install

# 3. Launch the desktop app in dev mode (hot reload)
bun run dev
```

### Package a distributable

`tauri build` runs `scripts/tauri-before.ts`, which compiles `libse` for the
current platform, bun-compiles the `se-worker` sidecar, and builds the CSS;
the Tauri bundler then packages everything with the `fe/` library.

```bash
bun run build    # → src-tauri/target/release/bundle/{macos,dmg}/
```

Cross-platform builds run in CI (`.github/workflows/build.yml`) on a macOS +
Linux + Windows matrix:

- macOS → ad-hoc-signed `SurfaceEvolver-macos-arm64.dmg`
- Linux → `SurfaceEvolver-linux-x64.deb`
- Windows → `SurfaceEvolver-windows-x64-setup.exe` (libse built with MinGW/MSYS2)

Grab them from the [Actions run](../../actions/workflows/build.yml) artifacts
(or a tagged release, if one exists). The macOS build is **ad-hoc signed, not
notarized** — see Known issues above for the Gatekeeper prompt.

### Linux launch

```bash
sudo apt install ./SurfaceEvolver-linux-x64.deb
surface-evolver
```

The `.deb` declares its GTK3/WebKitGTK dependencies.

### Windows launch

Run `SurfaceEvolver-windows-x64-setup.exe` (NSIS installer). The engine DLL is
built with MinGW; the app itself uses WebView2 (preinstalled on Windows 10/11).
Unsigned — SmartScreen will warn on first run: More info → Run anyway.

## Tests

```bash
# C API tests (requires built libse)
ctest --test-dir cmake-build-debug --output-on-failure

# Frontend type-check
cd ui && bunx tsc --noEmit
```

## Data files

`.fe` files in `fe/` define the geometry, constraints, and initial conditions for a
simulation. Add one from the **+** button in the file pane (built-in library or your
own upload). Examples: `cube.fe`, `sphere.fe`, `octa.fe`, `mound.fe`, `knotty.fe`,
`catenoid`/`cat.fe`, and more.

---

### A note on this project

This is a **hobby project** — built for fun and curiosity, not backed by any company
or roadmap. The heavy lifting is all Ken Brakke's original Surface Evolver engine;
this repo is just the result of my work for capstone and personal interest.

There can be bugs that have not been identified or tested when running the app. Additionally,
the code is not meant to be production grade. So, if you would like to use in a serious research environment,
please make sure to test all the functionality beforehand.

If any of it is useful to you, please help yourself. **Anyone is welcome to pick it
up, fork it, or take it further** — no permission needed.
