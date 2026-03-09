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

/* Run `steps` gradient-descent iterations (equivalent to "g steps"). */
void se_iterate(int steps);

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
 * Only valid for SOAPFILM LINEAR representation.
 * Returns number of triangles written, or -1 on error / wrong representation.
 * Caller must allocate: int out[max_count * 3]. */
int se_get_facets(int *out, int max_count);

/* ── body data ────────────────────────────────────────────────────────── */

/* Fill volumes[0..n-1] and/or pressures[0..n-1] (either may be NULL)
 * in body ordinal order.  Returns number of bodies, or -1 on error. */
int se_get_body_volumes(double *volumes, double *pressures, int max_count);

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
