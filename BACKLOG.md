# Backlog

Engine-capability backlog for the SE C API + viewer. Original scan 2026-06-28;
Phases 0–4 implemented and committed 2026-06-29 on branch
`feat/engine-api-and-viewer-expansion` (not yet merged/pushed).

---

## ✅ Done — Phases 0–4

Shipped end-to-end (C facade → bun:ffi worker → IPC/RPC → React viewer), each
with ctest coverage. See `git log` on the feature branch for the commits.

**Phase 0 — unblock + correctness**
- `se_get_edges` — edge→vertex pairs; **unblocks the STRING (1-D) model**
  (curve/filament `.fe` files rendered zero geometry before).
- `se_get_facets` relaxed to return `0` (not `-1`) for non-SOAPFILM.
- `se_get_bounding_box` — self-computed from vertices (the engine global lives
  in the graphics pipeline, excluded from the headless build).
- `se_get_lagrange_order` — UI warns on quadratic meshes (render is wrong).

**Phase 1 — scalar colormaps** (ride the generic `scalars` mesh param)
- `se_get_vertex_valences` (counted from edges — engine's cached field is empty
  on load), `se_get_vertex_star_areas`, `se_get_vertex_force_mags`,
  `se_get_vertex_energy_density`, `se_get_vertex_gaussian_curvatures`.
- 7 colormaps total in the viewer (+ height, mean curvature).

**Phase 2 — structured topology ops**
- Worker IPC `{cmd:"topo", op, n}` for refine/equi/vertex_avg/pop → element +
  named-counter deltas (counters accumulate; diffed before/after).
- `se_get_topo_counts`, `se_get_total_time`, `se_get_mesh_params`.

**Phase 3.1 — quantities & energy**
- `se_get_quantity*` + `se_get_method_instance*` → Quantities/energy panel.

**Phase 3.2 — inspector, body CM, settings**
- `se_get_body_cm` — **volume-weighted** centroid via tetrahedron-from-origin
  decomposition (engine `cm[]` is graphics-only → self-computed).
- `se_get_vertex_info` + `se_get_constraint_name` — click-to-pick vertex
  inspector (id, coords, attr flags, constraints) + body-CM markers.
- `se_get_physics`/`se_set_physics`, `se_set_mesh_params` → Settings panel;
  `total_time` navbar chip.

**Phase 4 — persistence**
- Auto-snapshot SE's exact-state dump after each mutating op; auto-restore the
  *evolved* surface on app restart (`persistence.ts`, `getRestore` RPC).

**Phase 5 — colours, normals, attributes** (commits 6fb7fd4d / 6eeb1b73 / 98a63866)
- **Per-element colour** — `se_get_facet_colors` / `se_get_edge_colors`; viewer
  "SE Colors" mode renders facets by their SE palette index (respects
  `set facet color`). Closes the Phase-1 categorical-colour deferral.
- **Generic user attributes** — `se_get_attribute_count/_info/_values`; user
  scalar **vertex** attributes appear as dynamic "Attr: NAME" colormaps.
  Filtered to `DUMP_ATTR` scalars (built-in EXTRAS read garbage at a naive
  offset). Edge/facet/body attrs are readable via C but not surfaced as
  colormaps.
- **Engine normals** — `se_get_facet_normals` (unit-normalised, correct on
  inverted facets). *Data layer only* — not wired into shading: it would force
  flat per-facet shading, a visual regression vs the smooth `computeVertexNormals`
  default. Available for a future normals overlay.
- **Per-edge length/density** — `se_get_edge_lengths` / `se_get_edge_densities`.
  *Data layer only* — no dedicated UI (the colormap pipeline is vertex-based;
  per-edge viz would need an edge-colour render path).

---

## ✅ Done — Phase 6 (commit 1d2464dc)

### Default render uses SE colours + theme tokens (was hardcoded green)
`useThemeColors` reads daisyUI tokens (`--bc`/`--p`) off `:root` and normalises
via canvas; `MeshGeometry` no longer hardcodes green. The default view honours
SE facet colours when a datafile assigns them (auto-detected → flat per-facet),
and falls back to the theme surface colour (smooth) for uncoloured (white/clear)
facets. Surface/edge/specular follow the OS light/dark theme.

---

## Remaining — marginal / nice-to-have

- **Fixed/constraint vertex colouring** — categorical at-a-glance colour;
  partly covered already by the click inspector's attr flags.
- **Raw per-facet area/density endpoints** — already folded into the
  `energy_density` colormap; separate exposure is minor.
- **Edge / facet / body attribute viz** — these attrs are readable in C; only
  *vertex* attrs are surfaced (as colormaps). Edge/facet colouring would need an
  element-colour render path (same one a per-edge-length viz would need).
- **Attributes defined in a datafile's command section** aren't listed in the
  load-time `vertex_attributes` (only header-defined ones) — they're still
  readable by name after a reload. Minor; refresh the list after `recalc` if it
  matters.

---

## Skip — speculative or infeasible (assessed 2026-06-29)

- **Quadratic/Lagrange curved-patch rendering** — high effort, niche files; we
  warn via `se_get_lagrange_order` instead. Defer indefinitely.
- **server.ts HTTP/WS parity** — `server.ts` is dead code: no script launches
  it, nothing imports it, no Dockerfile. Don't maintain parity for an unrun
  server.
- **Worker heartbeat for long `se_run`** — infeasible: a blocking FFI call can't
  emit progress on the worker's single JS thread. `iterate`'s batch-chunking
  already solves the long-op case.
- **`.dmp` re-import validation** — guards a feature that doesn't exist (upload
  is `.fe`-only).
- **`se_dump_to_buffer`** — mis-premised: `dump_buff` is an error-reporting
  helper, not the surface serializer. Exact dump already works via the export/
  persistence path.
- **Multi-session / multi-window** — no multi-window UI exists; speculative
  until it does.


## Bug 
  can't load 5pb.fe and run it

## MVP Goal

Being able to run all .fe files inside the /fe folder 