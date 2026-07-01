/*************************************************************
*  Surface Evolver C API
*  Facade for use with Python ctypes or other FFI callers.
*
*  Build: see Makefile target `libse`
*  Usage: #include "se_api.h", link against libse.so
*************************************************************/

#ifndef SE_API_H
#define SE_API_H

#ifdef __cplusplus
extern "C" {
#endif

/* ── lifecycle ────────────────────────────────────────────────────────── */

/* Initialize the SE runtime.  Must be called once before any other se_*
 * function.  Returns 0 on success, -1 on failure. */
int se_init(void);

/* Load a Surface Evolver datafile (.fe).  Replaces any currently loaded
 * surface.  Returns 0 on success, -1 on failure. */
int se_load(const char *filename);

/* ── command execution ────────────────────────────────────────────────── */

/* Execute a single SE language command (e.g. "g", "r", "u 3").
 * Output is captured; retrieve it with se_pop_output().
 * Returns 0 on success, non-zero if the command had an error. */
int se_run(const char *cmd);

/* ── scalar state ─────────────────────────────────────────────────────── */

double se_get_energy(void);   /* web.total_energy               */
double se_get_area(void);     /* web.total_area                  */
double se_get_scale(void);    /* web.scale (step-size factor)    */
void   se_set_scale(double s);

/* Spatial dimension of the ambient space (usually 3). */
int se_get_sdim(void);

/* ── element counts ───────────────────────────────────────────────────── */

int se_get_vertex_count(void);
int se_get_edge_count(void);
int se_get_facet_count(void);
int se_get_body_count(void);

/* ── mesh geometry ────────────────────────────────────────────────────── */

/* Fill out[0..n*sdim-1] with vertex coordinates packed as
 *   [x0,y0,z0,  x1,y1,z1, ...]
 * where sdim = se_get_sdim() and n = min(vertex_count, max_count).
 * Returns number of vertices written, or -1 on error.
 * Caller must allocate: double out[max_count * se_get_sdim()]. */
int se_get_vertices(double *out, int max_count);

/* Fill ids[0..n-1] with the 1-based SE ordinal for each vertex in the
 * same order as se_get_vertices().  Useful for diagnostics/mapping.
 * Returns number of vertices, or -1 on error. */
int se_get_vertex_ids(int *ids, int max_count);

/* Fill out[0..n*3-1] with triangle vertex indices (0-based, matching the
 * row order of se_get_vertices()) packed as [v0,v1,v2, v0,v1,v2, ...].
 * Only SOAPFILM produces triangles; STRING/SIMPLEX return 0 (no error).
 * Returns number of triangles written, or -1 on error.
 * Caller must allocate: int out[max_count * 3]. */
int se_get_facets(int *out, int max_count);

/* Fill out[0..n*2-1] with edge endpoint indices (0-based, matching the row
 * order of se_get_vertices()) packed as [t0,h0, t1,h1, ...].  Valid for every
 * representation; the only geometry the STRING (1-D) model produces.
 * Returns number of edges written, or -1 on error.
 * Caller must allocate: int out[max_count * 2]. */
int se_get_edges(int *out, int max_count);

/* ── per-element colour / normals / edge metrics ──────────────────────── */

/* SE colour-table index per facet (front/back), in se_get_facets row order.
 * Either array may be NULL. Returns count, or -1. CLEAR = -1. */
int se_get_facet_colors(int *front, int *back, int max_count);

/* Engine outward normal per facet, packed [nx,ny,nz,...] in se_get_facets row
 * order (SOAPFILM + sdim 3). Returns count, or -1. */
int se_get_facet_normals(double *out, int max_count);

/* Per-edge colour index / length / line-density, in se_get_edges row order.
 * Returns count, or -1. */
int se_get_edge_colors(int *out, int max_count);
int se_get_edge_lengths(double *out, int max_count);
int se_get_edge_densities(double *out, int max_count);

/* ── generic user-defined attributes ──────────────────────────────────── */
/* elem_type: VERTEX=0 EDGE=1 FACET=2 BODY=3. */

/* Number of attribute slots for an element type, or -1. */
int se_get_attribute_count(int elem_type);

/* name/type of attribute `idx`. Returns 0 if a readable numeric scalar, 1 to
 * skip (internal/array/function/non-numeric), -1 on error. */
int se_get_attribute_info(int elem_type, int idx, char *name, int name_size, int *type_out);

/* Per-element scalar value (cast to double) in element row order. Returns
 * count, or -1 if not a readable numeric scalar. */
int se_get_attribute_values(int elem_type, int idx, double *out, int max_count);

/* Axis-aligned bounds over sdim coords, computed from vertex positions.
 * out_min[] / out_max[] must hold se_get_sdim() doubles each.
 * Returns sdim on success, 0 if no vertices, -1 on error. */
int se_get_bounding_box(double *out_min, double *out_max);

/* Polynomial order of elements (web.lagrange_order).  >1 means edge-midpoint
 * control vertices exist and the linear render is wrong — UI should warn.
 * Returns the order, or -1 if uninitialised. */
int se_get_lagrange_order(void);

/* ── vertex scalar fields ─────────────────────────────────────────────── */

/* Fill out[0..n-1] with the discrete mean curvature at each vertex
 * (cotangent-Laplacian formula, unsigned scalar |H|).
 * n = min(vertex_count, max_count).
 * Returns number of vertices written, or -1 on error / unsupported surface. */
int se_get_vertex_mean_curvatures(double *out, int max_count);

/* Incident-edge count per vertex (one int each). Returns count or -1. */
int se_get_vertex_valences(int *out, int max_count);

/* Barycentric facet-star area per vertex (one double each). Returns count or -1. */
int se_get_vertex_star_areas(double *out, int max_count);

/* Magnitude of the per-vertex force vector (zero until an iteration runs).
 * Returns count or -1. */
int se_get_vertex_force_mags(double *out, int max_count);

/* Vertex-averaged surface energy (Σ incident facet area×density ÷ 3).
 * SOAPFILM only; returns count, 0 for other representations, -1 on error. */
int se_get_vertex_energy_density(double *out, int max_count);

/* Discrete Gaussian curvature per vertex, (2π − Σ angles) / star_area.
 * SOAPFILM + sdim 3; returns count or -1. */
int se_get_vertex_gaussian_curvatures(double *out, int max_count);

/* ── topology counters & mesh params ──────────────────────────────────── */

/* Number of counters se_get_topo_counts reports (see .c for the fixed order). */
#define SE_TOPO_COUNT 11

/* Cumulative topology-op counters in a fixed order (diff before/after a command
 * for per-command deltas).  Fills out[0..n-1]; returns n (<= SE_TOPO_COUNT) or -1. */
int se_get_topo_counts(int *out, int max_count);

/* Accumulated sum of applied scale factors — a total-motion proxy. */
double se_get_total_time(void);

/* Mesh-quality thresholds [min_area, min_length, max_len, temperature].
 * Returns number written (<= 4), or -1 on error. */
int se_get_mesh_params(double *out, int max_count);

/* Write the mesh-quality thresholds; recalc afterwards. Returns 0, or -1. */
int se_set_mesh_params(double min_area, double min_length, double max_len, double temperature);

/* Physics globals [gravflag, grav_const, pressflag, pressure]. Returns n, -1. */
int se_get_physics(double *out, int max_count);

/* Write the physics globals (non-zero grav_const forces gravity on); recalc
 * afterwards. Returns 0, or -1. */
int se_set_physics(double grav_const, int gravflag, double pressure, int pressflag);

/* ── body data ────────────────────────────────────────────────────────── */

/* Fill volumes[0..n-1] and/or pressures[0..n-1] (either may be NULL)
 * in body ordinal order.  Returns number of bodies, or -1 on error. */
int se_get_body_volumes(double *volumes, double *pressures, int max_count);

/* ── named quantities & method instances ──────────────────────────────── */

/* Raw quantity-slot count; iterate 0..count-1 calling se_get_quantity. */
int se_get_quantity_count(void);

/* Read quantity `idx`; out params may be NULL. Returns 0 on a real quantity,
 * -1 for an empty/deleted/default slot. flags bits: Q_ENERGY=1, Q_FIXED=2,
 * Q_INFO=4. */
int se_get_quantity(int idx, char *name, int name_size,
                    double *value, double *target, double *modulus, int *flags);

/* Raw method-instance count; iterate 0..count-1 calling se_get_method_instance. */
int se_get_method_instance_count(void);

/* Read method instance `idx`. Returns 0 on a real instance, -1 to skip.
 * `type` = element type, `value` = energy contribution. */
int se_get_method_instance(int idx, char *name, int name_size,
                           int *type, double *value);

/* Volume-weighted centre of mass of body at ordinal `body_idx` → out_xyz[0..2]
 * (computed from facet geometry; SOAPFILM + sdim 3). Returns 3, or -1 on error
 * / out-of-range / degenerate. */
int se_get_body_cm(int body_idx, double *out_xyz);

/* ── element inspector ────────────────────────────────────────────────── */

/* Detail for the vertex at sequential position `vpos` (se_get_vertices order).
 * out_id/out_xyz/out_attr/out_cons may be NULL. attr bits: FIXED 0x40,
 * BOUNDARY 0x80, CONSTRAINT 0x400. Returns the number of constraints on the
 * vertex (may exceed cons_max), or -1 on error / out-of-range. */
int se_get_vertex_info(int vpos, int *out_id, double *out_xyz, int *out_attr,
                       int *out_cons, int cons_max);

/* Name of constraint `con_idx` (1..highcon) → buf. Returns 0, or -1. */
int se_get_constraint_name(int con_idx, char *buf, int size);

/* ── output capture ───────────────────────────────────────────────────── */

/* Copy SE's captured stdout into buf (NUL-terminated), then reset the
 * capture buffer.  Returns number of bytes copied (excluding NUL). */
int se_pop_output(char *buf, int bufsize);

/* Same for SE's stderr / error messages. */
int se_pop_errout(char *buf, int bufsize);

/* NUL-terminated string describing the last API-level error. */
const char *se_last_error(void);

#ifdef __cplusplus
}
#endif

#endif /* SE_API_H */
