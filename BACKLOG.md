# Backlog

Branch `main`. Last reorg 2026-08-07 (foam audit; ported to Tauri since the
previous pass — the app is no longer Electrobun and `src/main/src/index.ts` is
gone, its handlers now live in `src-tauri/src/rpc.rs`).

Capability parity model: the **CLI pane sends any string to `se_run`, so every
compiled core command is already reachable**. Headless excludes only the
graphics pipeline (interactive render + PostScript) — the Three.js viewer
replaces it. So the gaps below are about *first-class UI/structured API* for
power features, not missing capability. Native graphics / PostScript export are
deliberately out of scope and **not** listed.

**One exception to that model, found in the foam audit:** periodic (torus) and
STRING-model geometry are *not* reachable from the CLI alone, because the gap is
in what the mesh API returns to the viewer, not in what the engine can compute.
See the Foam section.

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
  validation; restore-dump schema check; failed load kills its worker and clears
  the session; restore can't clobber a user-initiated load; `persist()` runs off
  the command path.
- **Platform**: ported to Tauri v2 (Rust backend + `se-worker` sidecar);
  macOS/Linux/Windows CI (libse on Windows via MinGW/MSYS2).
- **Removed this cycle** (intentional, not gaps): scalar heatmap colormaps,
  quick-command button bar, Docs feature, `react-router-dom`.

---

## Remaining — ranked (value vs effort)

Effort: **S** ≈ hours / **M** ≈ a day / **L** ≈ multi-day. No C/engine work
unless noted.

### P0 — blocking the MVP ("run every `.fe` in `/fe`") — ✅ DONE
1. ~~Fix load+run failures across `/fe`.~~ Root cause was `se_get_vertices`/
   `se_get_vertex_info` emitting `sdim` comps into a stride-3 buffer → 2-D/4-D
   files scrambled (the `isRenderable` filter had been hiding them). Fixed to a
   fixed 3-component stride (pad `z=0`); worker now `chdir`s to the datafile dir
   so relative includes resolve (`crystal.fe`'s `Wulff "octa.wlf"`). **25/27 load
   + render**; `slidestr.fe` (malformed open face loop) and `simplex3.fe` (empty
   render, see P3) are quarantined in `QUARANTINED_FE`, `src-tauri/src/rpc.rs:16`.
   Caveat found later: "renders" ≠ "renders correctly" for the periodic and
   STRING files — see Foam below.

### P1 — high value, cheap-to-moderate
2. **Hessian / eigenvalue stability panel** — the one high-value capability with
   *no* structured surface. Drive `eigenprobe(0)` (inertia → stability index) +
   `ritz(0,n)` (lowest spectrum) via `runCommand`, parse output, show a panel.
   No C changes. Scoped. **M**
3. **One-click topology / optimization ops** — `edgeswap`, `dissolve`, `weed`,
   `notch`, `autochop`, `detorus`, `rebody`, `optimize`, `conj_grad`, `jiggle`,
   `saddle`. Reuse the existing `runTopo`/Run-menu pattern; each is a button +
   `se_run`. **S**

---

## Foam / cellular models — audit 2026-08-07

Driver: a materials-science user working on soap-foam and grain-growth models.
Everything here was **measured** by loading the bundled foam files through the
worker, not inferred. Reproduce with the sidecar directly:
`{"cmd":"load","path":…}` then `{"cmd":"mesh","colors":true}` on stdin, with
`SE_LIB_PATH` set.

Bundled foam files: `100grain.fe` (2D STRING, 100 cells, `TORUS`+`PERIODS`),
`5pb.fe` (2D STRING, 5 bubbles), `phelanc.fe` (3D Weaire–Phelan, 8 cells,
`TORUS_FILLED` 2×2×2), `twointor.fe` / `symtest.fe` (Kelvin cells; `symtest`
uses `SYMMETRY_GROUP "torus"`), `octa.fe`. The heavy foam machinery lives in
`.cmd` scripts, not datafiles — `wetfoam2.cmd`, `foamface.cmd`, `percolate.cmd`,
`edge_tuber.cmd`, `detorus_capper.cmd`. Foam datafiles define **no** quantities,
constraints, boundaries or attributes, so the Quantities panel is largely
irrelevant to them.

**F1. Periodic (torus) geometry renders wrong.** *Measured:* wrap-around edges
are drawn as straight lines across the whole view — **103 of 368 edges (28%) in
`phelanc.fe`**, 25 of 300 in `100grain.fe` (max edge 1.27 vs median 0.066). No
layer — `se_api`, worker, `rpc.rs`, `ui` — has any notion of periodicity.
**4 of the 27 bundled `.fe` are periodic and all 4 are foam files**, so this hits
foam specifically and nothing else. *Tested fix:* `detorus` takes phelanc from
103 → **0** wrap-edges (100→180 v, 368→454 e, facets unchanged). But `detorus`
mutates the surface irreversibly, so it needs a render-only path (unwrap a
scratch copy, or drive SE's non-destructive `view_transform_generators` /
`transform_expr`, which `phelanc.fe` already declares). **M**

**F2. 2D/STRING cells don't render at all.** `se_get_facets` is SOAPFILM-only, so
`100grain.fe` returns **0 facets and 0 facet colours** — its 100 grains draw as a
bare edge web with no fill and no per-cell colour. Its 100 grain areas *are*
computed (`body_volumes`) and then discarded. Same root cause as P3 item 10
(SIMPLEX): the mesh accessor only speaks SOAPFILM. Needs a STRING-cell accessor
in C. **M–L**

**F3. Per-body data is computed, transported, and dropped.** `body_volumes` and
`body_pressures` reach the browser on every mesh fetch; nothing in `ui/src` reads
either, and `body_pressures` isn't even in the `MeshData` type
(`ui/src/api/simulation.ts`). For foam these are the primary observables. Pure
UI work, no C. *Workaround today:* `print body[N].volume`, or
`foreach body bb do printf "%g\n",bb.volume` in the CLI pane (verified on
`100grain.fe`; note `list bodies` shows facet/centroid, **not** volume). **S**

**F4. Colour-by-body is not currently possible.** No facet→body accessor is
exported from the facade (`get_facet_body` is used only inside `se_get_body_cm`),
so bubbles can't be visually distinguished. Needs new C. Supersedes/extends P3
item 7 for the foam case. **M**

**F5. T1/T2 events are invisible during normal evolution.** `handleTopo` diffs
all 11 topology counters and returns the deltas; `handleRun` returns none — so a
`g 500` coarsening run reports energy/area but not the pops, edgeswaps or
dissolves, which are the physics of interest. The counters already exist
(`se_get_topo_counts`). **S**

**F6. Foam's own operations are unexposed.** `TOPO_CMDS` has 4 entries and wires
`pop` as `pop vertices` only. Missing the ones the bundled foam macros actually
use: `o` (pop edges *and* vertices), `O` (edges only), `t x` (remove tiny edges),
plus engine-level `t1_edgeswap`, `dissolve`, `pop_tri_to_edge`,
`pop_edge_to_tri`, `pop_quad_to_quad`, `edgeswap`. Extends P1 item 3. **S**

**F7. `n` is never passed to `runTopo`.** `CliPane.tsx:60` calls
`runTopo(sessionId, op)` with no count, so Equiangulate is permanently `u 1`
despite the API and worker both supporting `n`. Plain bug. **S**

**F8. Quantity `target` / `modulus` are dropped.** Transported by the worker,
typed in `simulation.ts`, never rendered by `QuantitiesPanel`. For
volume-constrained foam these are exactly the numbers you want beside the value.
**S**

**F9. Foam `.cmd` scripts work but have no affordance.** *Verified:*
`read "foamface.cmd"` succeeds from the CLI pane (the worker `chdir`s to the
datafile dir and the `.cmd` files sit alongside). A script picker would surface
`wetfoam2` / `foamface` / `percolate` without users knowing the filenames. Note
`foamface_jvx.cmd` and `detorus_capper.cmd` call `detorus` and so mutate the
surface irreversibly — warn before running. **S–M**

---

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
   vertex colouring at a glance. Note `edge_colors` is already computed and sent
   and simply not read by the UI, and facet *back* colours are computed in C then
   dropped by the worker. See F4 — the body case additionally needs new C. **M**
8. **Engine facet normals → optional flat-shaded overlay** — `se_get_facet_normals`
   exists but isn't wired to shading (would regress the smooth default). Make it
   an opt-in toggle. **S**
9. **Refresh attribute list after `recalc`** — attrs defined in a datafile's
   command section aren't in the load-time list (header-defined only). **S**
10. **SIMPLEX geometry rendering** — `SIMPLEX_REPRESENTATION` files (e.g.
    `simplex3.fe`, sdim=4) load + run but render empty: `se_get_facets` is
    SOAPFILM-only, so simplex cells aren't exposed. Needs a simplex→triangle
    accessor. Currently quarantined from the picker. **M**, niche.
    Same root cause as F2 (STRING cells) — if the mesh accessor is taught to
    speak non-SOAPFILM representations, do both at once.
11. **Fix or replace `slidestr.fe`** — bundled STRING datafile with an open face
    edge loop the engine rejects at load. Quarantined. Fixing needs the intended
    geometry (don't guess); may just be a bad bundled copy. **S**, niche
12. **Lagrange / curved-patch rendering** — quadratic patches render as straight
    edges; we only warn. High effort, niche files. Defer unless a target file
    needs it. **L**

---

## Skip — infeasible / speculative (assessed, do not build)

- **`server.ts` HTTP/WS parity** — dead code; nothing launches or imports it.
- **Worker heartbeat for long `se_run`** — a blocking FFI call can't emit
  progress on the worker's single JS thread. The first half of that assessment
  stands; the old "`iterate` batch-chunking covers it" claim does **not** — there
  is no `iterate` command in the worker (cmds are `load`, `run`, `mesh`,
  `set_scale`, `topo`, `quantities`, `vertex_info`, `settings`, `set_settings`,
  `dump`), and nothing emits the `{"type":"progress"}` message the protocol
  documents. So a long run (`g 1000`, normal for foam coarsening) blocks with no
  feedback. Still not fixable by a heartbeat, but it *is* fixable by chunking on
  the caller side — issue `g 50` ×20 and report between chunks. Reclassify if
  someone wants it; the entry stays here only because the *heartbeat* approach is
  dead, not the goal.
- **`.dmp` re-import validation** — guards a non-existent feature (upload is
  `.fe`-only).
- **`se_dump_to_buffer`** — mis-premised; `dump_buff` is an error-message helper.
  Exact dump already works via export/persistence.
- **Multi-session / multi-window** — no multi-window UI exists; the engine is
  one-worker-per-session anyway. Tabs are a recently-opened list, not live
  parallel sessions.
