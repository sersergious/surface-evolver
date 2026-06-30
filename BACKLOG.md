# Backlog

Branch `feat/engine-api-and-viewer-expansion`. Last reorg 2026-06-30.

Capability parity model: the **CLI pane sends any string to `se_run`, so every
compiled core command is already reachable**. Headless excludes only the
graphics pipeline (interactive render + PostScript) — the Three.js viewer
replaces it. So the gaps below are about *first-class UI/structured API* for
power features, not missing capability. Native graphics / PostScript export are
deliberately out of scope and **not** listed.

---

## Done (current state)

Full commit history in `git log`. Headline:

- **Engine API** (`se_api`): geometry (verts/edges/facets), normals, edge
  length/density, counts, energy/area/scale/sdim, bounding box, body
  volumes/pressure/CM, quantities + energy methods, physics, mesh params, vertex
  info + constraints, generic attributes, topo counters, curvatures/valence.
  Headless-excluded globals (bbox, normals, CM) self-recomputed in `se_api.c`.
- **App**: open-files tabs + modal file browser; CLI (full command access) +
  Run-menu topology (refine/equi/vertex-avg/pop) + iterate; 3D viewer with
  render modes, **native SE per-element colours**, all-edge overlay, inspect/pick,
  body-CM markers, auto-fit camera; Quantities and Settings (physics + mesh
  params) panels; export fe/dmp; auto-snapshot + restore persistence; native
  window drag; heroicon toolbar.
- **Guardrails**: worker-death self-clears state; `set_settings` numeric
  validation; restore-dump schema check.
- **Removed this cycle** (intentional, not gaps): scalar heatmap colormaps,
  quick-command button bar, Docs feature, `react-router-dom`.

---

## Remaining — ranked (value vs effort)

Effort: **S** ≈ hours / **M** ≈ a day / **L** ≈ multi-day. No C/engine work
unless noted.

### P0 — blocking the MVP ("run every `.fe` in `/fe`")
1. **Fix load+run failures across `/fe`** — `5pb.fe` can't load/run; audit the
   whole `fe/` set, fix or quarantine each. Correctness; gates the MVP. **M**

### P1 — high value, cheap-to-moderate
2. **Hessian / eigenvalue stability panel** — the one high-value capability with
   *no* structured surface. Drive `eigenprobe(0)` (inertia → stability index) +
   `ritz(0,n)` (lowest spectrum) via `runCommand`, parse output, show a panel.
   No C changes. Scoped. **M**
3. **One-click topology / optimization ops** — `edgeswap`, `dissolve`, `weed`,
   `notch`, `autochop`, `detorus`, `rebody`, `optimize`, `conj_grad`, `jiggle`,
   `saddle`. Reuse the existing `runTopo`/Run-menu pattern; each is a button +
   `se_run`. **S**

### P2 — medium
4. **Macros (gogo-style)** — store `{name, body}` app-side, run by sending the
   body via `runCommand` (survives file switches, no engine re-registration).
   Panel with Run/edit/delete + "save last CLI command". **M**
5. **Structured `list` / `print` / `histogram`** — today raw text in the log;
   parse `se_pop_output` into a table/chart. **S–M**
6. **Define quantities / constraints / methods UI** — currently view-only;
   defining needs CLI/`.fe`. Form → command string. **L**

### P3 — low / niche
7. **Element-colour render path for edge/facet/body attributes** — these attrs
   are readable in C but only the (removed) vertex-colormap path consumed them;
   a categorical per-element render path would surface them + fixed/constraint
   vertex colouring at a glance. **M**
8. **Engine facet normals → optional flat-shaded overlay** — `se_get_facet_normals`
   exists but isn't wired to shading (would regress the smooth default). Make it
   an opt-in toggle. **S**
9. **Refresh attribute list after `recalc`** — attrs defined in a datafile's
   command section aren't in the load-time list (header-defined only). **S**
10. **Lagrange / curved-patch rendering** — quadratic patches render as straight
    edges; we only warn. High effort, niche files. Defer unless a target file
    needs it. **L**

---

## Skip — infeasible / speculative (assessed, do not build)

- **`server.ts` HTTP/WS parity** — dead code; nothing launches or imports it.
- **Worker heartbeat for long `se_run`** — a blocking FFI call can't emit
  progress on the worker's single JS thread; `iterate` batch-chunking covers it.
- **`.dmp` re-import validation** — guards a non-existent feature (upload is
  `.fe`-only).
- **`se_dump_to_buffer`** — mis-premised; `dump_buff` is an error-message helper.
  Exact dump already works via export/persistence.
- **Multi-session / multi-window** — no multi-window UI exists; the engine is
  one-worker-per-session anyway. Tabs are a recently-opened list, not live
  parallel sessions.
