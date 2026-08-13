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

/* ── return-value convention ──────────────────────────────────────────────
 *  -1  bad arguments, uninitialised runtime, or a genuine failure
 *   0  "not applicable to this surface" — e.g. an accessor gated on the
 *      SOAPFILM representation or on a periodic surface. Not an error; the
 *      caller should treat it as an empty result.
 *  >0  number of elements written.
 * Some accessors used to report a wrong representation as -1 and others as 0;
 * they now all use 0. */

/* ── lifecycle ────────────────────────────────────────────────────────── */

/* Initialize the SE runtime.  Must be called once before any other se_*
 * function.  Returns 0 on success, -1 on failure. */
int se_init(void);

/* Load a Surface Evolver datafile (.fe).  Replaces any currently loaded
 * surface.  Returns 0 on success, -1 on failure.
 * Only the SOAPFILM (2-D triangulated) model is accepted: STRING and SIMPLEX
 * datafiles are rejected with an se_last_error() explaining why, because
 * se_get_facets() cannot express their cells.  Engine state after a failed
 * load is undefined — discard the process or reload a valid file. */
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

/* Spatial dimension of the ambient space (usually 3). */
int se_get_sdim(void);

/* ── element counts ───────────────────────────────────────────────────── */

int se_get_vertex_count(void);
int se_get_edge_count(void);
int se_get_facet_count(void);
int se_get_body_count(void);

/* ── mesh geometry ────────────────────────────────────────────────────── */

/* Fill out[0..n*3-1] with vertex coordinates packed as
 *   [x0,y0,z0,  x1,y1,z1, ...]
 * where n = min(vertex_count, max_count).
 * The stride is ALWAYS 3, independent of se_get_sdim(): coordinates beyond
 * sdim are zero-padded (2-D models render flat) and only the first 3 are kept
 * for sdim > 3 (e.g. simplex sdim=4). Callers therefore get a uniform layout.
 * Returns number of vertices written, or -1 on error.
 * Caller must allocate: double out[max_count * 3]. */
int se_get_vertices(double *out, int max_count);

/* Fill ids[0..n-1] with the 1-based SE ordinal for each vertex in the
 * same order as se_get_vertices().  Useful for diagnostics/mapping.
 * Returns number of vertices, or -1 on error. */
int se_get_vertex_ids(int *ids, int max_count);

/* Fill out[0..n*3-1] with triangle vertex indices (0-based, matching the
 * row order of se_get_vertices()) packed as [v0,v1,v2, v0,v1,v2, ...].
 * Only SOAPFILM produces triangles; STRING/SIMPLEX return 0 (no error).
 * That guard is now unreachable through se_load(), which rejects both — it
 * stays as a safety net for callers that drive the engine some other way.
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
 * Either array may be NULL. Returns count, 0 for a non-SOAPFILM surface, or
 * -1 on bad arguments. Colour CLEAR is -1. */
int se_get_facet_colors(int *front, int *back, int max_count);

/* Per-edge colour index, in se_get_edges row order. Returns count, or -1. */
int se_get_edge_colors(int *out, int max_count);

/* Per-edge wrap code, in se_get_edges row order. 0 = the edge does not cross a
 * period boundary; non-zero packs 6 bits per dimension (torus.c). Returns the
 * count written, 0 if the surface is not periodic, or -1 on error.
 * Read-only: unlike SE's `detorus`, this mutates nothing. */
int se_get_edge_wraps(int *out, int max_count);

/* Axis-aligned bounds over sdim coords, computed from vertex positions.
 * out_min[] / out_max[] must hold se_get_sdim() doubles each.
 * Returns sdim on success, 0 if no vertices, -1 on error. */
int se_get_bounding_box(double *out_min, double *out_max);

/* Polynomial order of elements (web.lagrange_order).  >1 means edge-midpoint
 * control vertices exist and the linear render is wrong — UI should warn.
 * Returns the order, or -1 if uninitialised. */
int se_get_lagrange_order(void);

/* ── topology counters & mesh params ──────────────────────────────────── */

/* Number of counters se_get_topo_counts reports (see .c for the fixed order). */
#define SE_TOPO_COUNT 11

/* Cumulative topology-op counters in a fixed order (diff before/after a command
 * for per-command deltas).  Fills out[0..n-1]; returns n (<= SE_TOPO_COUNT) or -1. */
int se_get_topo_counts(int *out, int max_count);

/* ── body data ────────────────────────────────────────────────────────── */

/* Fill volumes[0..n-1] and/or pressures[0..n-1] (either may be NULL)
 * in body ordinal order.  Returns number of bodies, or -1 on error. */
int se_get_body_volumes(double *volumes, double *pressures, int max_count);

/* Volume-weighted centre of mass of body at ordinal `body_idx` → out_xyz[0..2]
 * (computed from facet geometry; SOAPFILM + sdim 3). Returns 3, 0 if the
 * surface is not SOAPFILM/sdim-3, or -1 on bad arguments / out-of-range /
 * degenerate. */
int se_get_body_cm(int body_idx, double *out_xyz);

/* ── element inspector ────────────────────────────────────────────────── */

/* Detail for the vertex at sequential position `vpos` (se_get_vertices order).
 * out_id/out_xyz/out_attr/out_cons may be NULL. out_xyz takes ALWAYS 3 doubles
 * (same fixed stride and zero-padding as se_get_vertices, not sdim).
 * attr bits: FIXED 0x40, BOUNDARY 0x80, CONSTRAINT 0x400. Returns the number of
 * constraints on the vertex (may exceed cons_max), or -1 on error / out-of-range. */
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
