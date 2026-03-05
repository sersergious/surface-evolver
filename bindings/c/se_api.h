/*
 * Public C facade header for Surface Evolver.
 *
 * This header declares a small, stable API that external code (e.g. Python
 * via ctypes) can use without having to depend on Evolver's internal headers.
 *
 * The corresponding implementation is in bindings/c/se_api.c.
 */

#ifndef SE_API_H
#define SE_API_H

#ifdef __cplusplus
extern "C" {
#endif

/*-----------------------------------------------------------------------------
 *  Runtime lifecycle
 *---------------------------------------------------------------------------*/

/* Initialize Evolver runtime (call once per process before other calls). */
int  se_init_runtime(void);

/* Optional cleanup hook for explicit teardown. */
void se_shutdown_runtime(void);

/*-----------------------------------------------------------------------------
 *  Datafile loading
 *---------------------------------------------------------------------------*/

/* Load a Surface Evolver datafile (.fe) from disk. */
int  se_load_datafile(const char *path);

/* Load a model from an in‑memory datafile string. */
int  se_load_data(const char *text, int length);

/*-----------------------------------------------------------------------------
 *  Command execution
 *---------------------------------------------------------------------------*/

/*
 * Execute a single Evolver command line.
 *
 * - cmd      : null‑terminated command string.
 * - out_buf  : buffer to receive textual output (stdout + stderr).
 * - out_len  : size of out_buf in bytes.
 *
 * Returns 0 on success, non‑zero on error.
 */
int  se_exec_command(const char *cmd, char *out_buf, int out_len);

/*-----------------------------------------------------------------------------
 *  Mesh export (for graphics)
 *---------------------------------------------------------------------------*/

/* Counts of active vertices / facets. */
int  se_get_vertex_count(void);
int  se_get_facet_count(void);

/*
 * Export vertex positions as doubles:
 *  - out_xyz length >= 3 * max_vertices
 *  - vertex i → out_xyz[3*i + 0..2] = (x, y, z)
 * Returns number of vertices written.
 */
int  se_get_vertices(double *out_xyz, int max_vertices);

/*
 * Export triangular facets as vertex indices:
 *  - out_tris length >= 3 * max_facets
 *  - facet j → out_tris[3*j + 0..2] = (v0, v1, v2)
 * Returns number of facets written.
 */
int  se_get_facets(int *out_tris, int max_facets);

/*-----------------------------------------------------------------------------
 *  Status helpers
 *---------------------------------------------------------------------------*/

double se_get_total_energy(void);
double se_get_total_area(void);

/* Surface dimension (e.g. 2 for surfaces). */
int    se_get_dimension(void);

/* Ambient space dimension (e.g. 3 for R^3). */
int    se_get_space_dim(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* SE_API_H */
