# Backlog

Engine scan completed 2026-06-28. Each item names the exact C global/macro/function
that provides the data and the effort to expose it.

---

## Gaps found in re-scan (2026-06-28) — not in the priority lists below

A second pass over `engine/src` + `engine/bindings/c/se_api.c` turned up engine
capabilities that are unexposed **and** were not captured anywhere below. These are
ranked by impact.

### ⚑ Edge topology (endpoints) — highest impact
`get_edge_tailv(e_id)` / `get_edge_headv(e_id)` (proto.h:1192-1193) give the two
vertices of every edge. **No `se_get_edges()` exists.** The API exposes facet→vertex
triples (`se_get_facets`) but never edge→vertex pairs, so the viewer cannot draw a
true wireframe or render the **STRING (1-D) model** at all. Note `se_get_facets()`
hard-returns `-1` unless `web.representation == SOAPFILM` (se_api.c:303), so every
curve/filament `.fe` file currently produces *zero* geometry.

**C work:** `se_get_edges(int *out, int max_count)` — two ordinal positions per edge,
reusing the same ordinal→position map `se_get_facets` builds. Drop the SOAPFILM guard
for this one. **This single addition unblocks the entire STRING model.**

### Facet / vertex normals
`get_facet_normal(f_id, REAL *out)` (proto.h:493) returns the engine's true outward
normal (handles inverted facets and lagrange order correctly). The viewer currently
recomputes normals in JS from triangle winding.

**C work:** `se_get_facet_normals(double *out, int max_count)`.

### Bounding box (camera auto-framing)
`bounding_box[MAXCOORD][2]` (extern.h:1302), refreshed when `need_bounding_box`
(extern.h:1297) is set. Lets the viewer frame the camera to the mesh on load instead
of guessing a scale.

**C work:** `se_get_bounding_box(double *out_min, double *out_max)` — set the flag,
trigger recompute, read the array.

### Higher-order (Lagrange / quadratic) model — correctness gotcha
`web.lagrange_order` (web.h:32) > 1 means facets carry edge-midpoint control vertices.
`se_get_vertices` then returns those midpoints too (inflated count) and `se_get_facets`
still emits only the 3 corner positions — so quadratic-model meshes render wrong.
**C work:** at minimum expose `se_get_lagrange_order()` so the UI can warn / refuse;
full fix is interpolating the curved patches.

### Generic user-defined attributes
`define vertex attribute foo real` is stored via `web.skel[type].extra_count` +
`EXTRAS(type)[attr]` (skeleton.h:68, 400-409); each `struct extra` has `name`, `offset`,
type. SE scripts lean on these to drive their own coloring/logic, but the API can't
read them. **C work:** `se_list_attributes(...)` + a typed `se_get_attribute(...)`.
Larger effort; defer, but worth a placeholder so it isn't forgotten.

### True engine-state dump for session persistence
`dump()` (proto.h:936) / `dump_buff(char*, size_t)` (proto.h:757) serialize the live
surface as a reloadable datafile. The "Session persistence" item below proposes a JSON
sidecar, but capturing SE's own dump is the only way to round-trip *exact* topology +
constraints. **C work:** `se_dump_to_buffer(char *buf, int bufsize)` wrapping
`dump_buff`.

### Physics globals (gravity / ambient pressure)
`web.gravflag`, `web.grav_const`, `web.pressure`, `web.pressflag` (web.h:53-88) — a
read/write "physics" panel. Trivial struct reads; low priority.

**Correction to Priority 3 below:** there is **no** `get_v_constraint_map()` symbol.
A vertex's constraint bitmap lives in the `V_CONSTRAINT_LIST` extra attribute
(set via `set_v_conmap`, proto.h:380); constraint names come from `GETCONSTR(n)->name`
with `web.highcon` (extern.h:316, web.h:36). Adjust the proposed signature accordingly.

---

## Priority 1 — Trivial (global reads, no element walk)

### Iteration / motion counter
`total_time` (extern.h) accumulates the sum of scale factors applied — a proxy for
total surface motion. `gocount` holds the remaining step count during a `g N` run.

**C work:** `se_get_total_time() → double` reading `total_time`.
**UI use:** Show alongside energy/area in the navbar so users can track cumulative
motion without reading the terminal.

---

### Topology operation counters
`web` (web.h) carries 20+ `int` counters reset on each topology command:
`equi_count`, `edge_refine_count`, `facet_refine_count`, `vertex_dissolve_count`,
`edge_dissolve_count`, `facet_dissolve_count`, `vertex_pop_count`, `edge_pop_count`,
`edgeswap_count`, `fix_count`, `unfix_count`, etc.

**C work:** `se_get_topo_counts(struct se_topo_counts *out)` — one struct read.
**UI use:** Show a brief summary after `r`, `u`, `V`, or `pop` commands
(e.g. "12 edges refined, 4 vertices dissolved") instead of relying on SE's raw
text output.

---

### Body center-of-mass
`bptr(b_id)->cm[MAXCOORD]` — per-body centre-of-mass vector, always computed.
`bptr(b_id)->density` — gravitational mass density.

**C work:** `se_get_body_cm(int body_idx, double *out_xyz)`.
**UI use:** Render body centroid markers in the 3D viewer.

---

### Mesh quality bounds
`web.min_area`, `web.min_length`, `web.max_len`, `web.temperature` (web.h).

**C work:** `se_get_mesh_params(struct se_mesh_params *out)` — struct of 4 doubles.
**UI use:** Surface those in a "Mesh settings" panel so users can tweak them without
typing `set min_length …` in the terminal.

---

## Priority 2 — Easy (element walk, direct field access)

### Per-vertex valence
`vptr(v_id)->valence` (skeleton.h) — incident edge count, maintained incrementally.
Regular triangular meshes have valence 6; outliers flag topology problems.

**C work:** `se_get_vertex_valences(int *out, int max_count)` — one field per vertex.
**Scalar colormap:** Immediate addition to the viewer's color-mode dropdown.

---

### Per-vertex fixed / constraint status
`get_attr(v_id)` returns a bitmap; `FIXED` (0x40), `PINNED_V` (0x08),
`CONSTRAINT` (0x400), `BOUNDARY` (0x80) are the relevant bits (extern.h).

**C work:** `se_get_vertex_flags(int *out, int max_count)` — one int per vertex.
**UI use:** Colour fixed vertices distinctly in the 3D viewer; show constraint
membership in a future element-inspector panel.

---

### Per-vertex star area
`get_vertex_area_star(v_id)` (proto.h) — mixed (barycentric) area around each vertex.
Requires walking incident facets; already computed internally as part of the
mean-curvature formula.

**C work:** `se_get_vertex_star_areas(double *out, int max_count)`.
**Scalar colormap:** Energy-density proxy without the cotangent-weight complexity.

---

### Per-vertex force vector
`get_force(v_id)` (skeleton.h) — gradient / descent direction, populated after each
iteration. Length reflects the magnitude of the net force on that vertex.

**C work:** `se_get_vertex_forces(double *out, int max_count)` — sdim doubles per vertex.
**UI use:** Optional force-vector overlay in the 3D viewer; or magnitude as a scalar
colormap to highlight high-tension regions.

---

### Per-facet area and density
`get_facet_area(f_id)` (proto.h) — current area (not the cached stale field).
`get_facet_density(f_id)` (skeleton.h inline) — per-facet surface tension coefficient.

**C work:** `se_get_facet_areas(double *out, int max_count)` and
`se_get_facet_densities(double *out, int max_count)`.
**Scalar colormap:** Energy density = area × density per facet, mapped to vertices
by averaging incident facets — more physically direct than height or curvature.

---

### Per-edge length and density
`get_edge_length(e_id)` (proto.h) — current length (forces recompute).
`get_edge_density(e_id)` (skeleton.h inline) — line-tension coefficient.

**C work:** `se_get_edge_lengths(double *out, int max_count)`,
`se_get_edge_densities(double *out, int max_count)`.
**UI use:** Edge lengths useful for mesh-quality analysis; densities needed if we
ever render edges with per-element colour.

---

### Per-element colour
`get_facet_frontcolor(f_id)`, `get_facet_backcolor(f_id)`, `get_edge_color(e_id)`
(skeleton.h inline macros) — integer colour index from the SE colour table.

**C work:** `se_get_facet_colors(int *front, int *back, int max_count)`,
`se_get_edge_colors(int *out, int max_count)`.
**UI use:** Respect user-assigned colours in SE scripts (`set facet color red`).
Currently the viewer ignores colours entirely.

---

## Priority 3 — Medium (quantity system, constraint lists)

### Named quantity values
`gen_quant_list[0..gen_quant_count-1]` (quantity.h) — user-defined and built-in
quantities. Each entry has `name[QNAMESIZE]`, `value` (double), `target`, `modulus`,
and `flags` (Q_ENERGY, Q_FIXED, Q_INFO…). Values are current after `recalc()`.

**C work:** `se_get_quantities(struct se_quantity *out, int max_count)` returning
`{ name, value, target, flags }` per entry, skipping DEFAULT_QUANTITY entries.
**UI use:** Display named quantities in a "Quantities" panel — essential for users
running scripts that define custom energies.

---

### Method instance energy breakdown
`meth_inst_list[0..meth_inst_count-1]` (quantity.h) — each method instance has
`name`, `type` (VERTEX/EDGE/FACET/BODY), and `value` (its energy contribution).

**C work:** `se_get_method_instances(struct se_method_inst *out, int max_count)`.
**UI use:** Energy breakdown panel showing contribution of each method to total energy.

---

### Constraint membership per element
`get_v_constraint_map(v_id)` returns a `conmap_t` bitmap; bit `k` means constraint `k`
is active. `web.constraints[k].name` gives the constraint name; `web.highcon` is the
highest used index.

**C work:** `se_get_vertex_constraint_map(int *out, int max_count)` (one int bitmask
per vertex) + `se_get_constraint_names(char **out, int max_count)`.
**UI use:** Element inspector showing which constraints a selected vertex satisfies.

---

### Gaussian curvature per vertex
K = (2π − Σ incident face angles) / star_area. The engine exposes
`gauss_curvature_integral` as a named quantity method but not as a per-vertex array.

**C work:** New `se_get_vertex_gaussian_curvatures(double *out, int max_count)` —
iterate `FOR_ALL_FACETS`, accumulate angle at each vertex using `dot(e1,e2)/|e1||e2|`,
then divide (2π − angle_sum) by star area.
**Scalar colormap:** Positive = convex peaks, negative = saddle points. Most useful
once mean curvature is established.

---

## Priority 4 — Commands without dedicated API endpoints

These all work today via `se_run("cmd")` but get no structured return value,
no progress signal, and no cancelled-job semantics.

| SE command | Effect | What's missing |
|---|---|---|
| `r` / `refine edges` | Subdivide long edges | Structured result: counts of edges/facets added |
| `u N` | Equiangulate N passes | Progress per pass + swap count |
| `V` | Vertex averaging | Per-step energy delta |
| `pop vertex` / `pop edge` | Topology repair | Count of pops performed |
| `jiggle` | Thermal jiggling via `web.temperature` | Progress + energy range |
| `recalc` | Recompute all energies | Explicit trigger so UI can sync state |

**Recommended approach:** Add a `{"cmd":"refine"|"equi"|"vertex_avg"|"pop", "n":N}`
message type to the worker IPC protocol. Returns `{"ok":true, "counts":{…}, "energy":E}`.
This enables progress display and structured feedback without changing the C API.

---

## Priority 5 — Deferred scalar colormaps (from original backlog)

### Gaussian curvature (see Priority 3 above for C work)
### Star area per vertex (see Priority 2 above — `se_get_vertex_star_areas`)
### Valence per vertex (see Priority 2 above — `se_get_vertex_valences`)
### Energy density per vertex
Compute vertex-averaged facet energy density: for each incident facet accumulate
`get_facet_area(f_id) × get_facet_density(f_id) / 3`. Requires `se_get_facet_areas`
and `se_get_facet_densities` (Priority 2).

---

## Other Deferred Items (unchanged from original backlog)

### `.dmp` re-import validation
Parse the first 20 lines of an uploaded `.dmp` file and confirm SE header markers
before calling `se_load()`.

### WebSocket / streaming progress for `run` command
Long-running `se_run("u 100")` calls block with no signal. Add a timeout-based
heartbeat from the worker (`{"type":"heartbeat","elapsed_ms":N}`) so the UI doesn't
appear frozen.

### Session persistence to disk
Serialise `SessionState` to a JSON sidecar next to the `.fe` file; restore on
app restart.

### Multi-session support
Explore multiple `Bun.spawn` worker subprocesses so a future multi-window layout
can have one SE instance per window.
