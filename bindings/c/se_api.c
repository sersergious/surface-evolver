/*
 * Surface Evolver C facade for external bindings (e.g. Python ctypes).
 *
 * This file is intentionally small and self‑contained: it exposes a stable,
 * C‑style API that higher‑level code can call without needing to know about
 * internal globals, macros, or data structures. The implementations below are
 * just boilerplate scaffolding; fill them in by calling existing Evolver
 * internals (from tmain.c, userio.c, calcforc.c, quantity.c, etc.).
 */

#include "include.h"

/*-----------------------------------------------------------------------------
 *  Runtime lifecycle
 *---------------------------------------------------------------------------*/

/*
 * Initialize Evolver runtime (global state, memory, etc.).
 *
 * Recommended implementation:
 *  - Factor the non-interactive initialization parts out of main() in
 *    core/tmain.c into a helper, then call that helper here.
 *  - Do NOT start the command loop here; this should be a one-shot init.
 */
int se_init_runtime(void)
{
  /* TODO: factor initialization from main() in core/tmain.c and call it. */
  return 0;  /* 0 = success */
}

/*
 * Optional: clean up global state if you need explicit teardown.
 * For now this is just a placeholder.
 */
void se_shutdown_runtime(void)
{
  /* TODO: add any explicit cleanup needed for a long‑running host process. */
}

/*-----------------------------------------------------------------------------
 *  Datafile loading
 *---------------------------------------------------------------------------*/

/*
 * Load a Surface Evolver datafile (.fe) from disk.
 *
 * Recommended implementation:
 *  - Use the same path as normal startup does when invoked as
 *      evolver some.fe
 *    e.g. via startup(path) or exec_file(), and associated datafile
 *    parsing helpers in core/datafile.lex and core/userio.c.
 */
int se_load_datafile(const char *path)
{
  if ( path == NULL )
    return -1;

  /* TODO: open and load the datafile using existing Evolver loaders. */
  (void)path;
  return -1;  /* non-zero = failure until implemented */
}

/*
 * Load a model from an in‑memory datafile string.
 *
 * Recommended implementation:
 *  - Wrap the text in a FILE* (e.g. fmemopen on POSIX) and feed it to the
 *    existing datafile parser (exec_file / push_datafd stack).
 */
int se_load_data(const char *text, int length)
{
  if ( text == NULL || length <= 0 )
    return -1;

  /* TODO: feed 'text' into the datafile parser (e.g. via fmemopen + exec_file). */
  (void)text;
  (void)length;
  return -1;
}

/*-----------------------------------------------------------------------------
 *  Command execution with captured text output
 *---------------------------------------------------------------------------*/

/*
 * Execute a single Evolver command line, capturing textual output.
 *
 * Arguments:
 *  - cmd       : null‑terminated command string (e.g. "iterate 10").
 *  - out_buf   : caller‑allocated buffer to hold combined stdout/stderr.
 *  - out_len   : size of out_buf in bytes.
 *
 * Returns:
 *  - 0 on success, non‑zero on error.
 *
 * Recommended implementation:
 *  - Save current outfd / erroutfd (from userio.c).
 *  - Redirect them to a temporary FILE* or custom writer that appends to
 *    an internal buffer.
 *  - Call command((char *)cmd, 0) or exec_commands(...) as appropriate.
 *  - Restore outfd / erroutfd.
 *  - Copy the captured text into out_buf, ensuring null‑termination.
 */
int se_exec_command(const char *cmd, char *out_buf, int out_len)
{
  if ( cmd == NULL || out_buf == NULL || out_len <= 0 )
    return -1;

  /* Ensure the buffer always contains a valid empty string. */
  out_buf[0] = '\0';

  /* TODO:
   *  - Capture output by temporarily redirecting outfd / erroutfd.
   *  - Invoke command((char *)cmd, 0) or exec_commands().
   *  - Copy captured output into out_buf (truncating if needed).
   */

  (void)cmd;
  return -1;
}

/*-----------------------------------------------------------------------------
 *  Mesh export for graphics
 *---------------------------------------------------------------------------*/

/*
 * Get the number of active vertices and facets in the current web.
 *
 * Recommended implementation:
 *  - Use web.skel[VERTEX].count and web.skel[FACET].count, or iterate with
 *    FOR_ALL_VERTICES / FOR_ALL_FACETS if you need more control.
 */
int se_get_vertex_count(void)
{
  /* TODO: return the actual number of active vertices. */
  return 0;
}

int se_get_facet_count(void)
{
  /* TODO: return the actual number of active facets. */
  return 0;
}

/*
 * Export vertex positions as doubles in a flat array.
 *
 * Conventions:
 *  - out_xyz must have space for at least 3 * max_vertices doubles.
 *  - Vertex i is stored at out_xyz[3*i + 0..2] = (x, y, z).
 *  - Returns the number of vertices actually written (<= max_vertices).
 *
 * Recommended implementation:
 *  - Iterate over all vertices in a deterministic order (e.g. by ordinal or
 *    FOR_ALL_VERTICES).
 *  - For each vertex_id v, obtain coordinates with get_coord(v) (REAL*),
 *    then cast to double.
 */
int se_get_vertices(double *out_xyz, int max_vertices)
{
  if ( out_xyz == NULL || max_vertices <= 0 )
    return 0;

  /* TODO: fill out_xyz with vertex coordinates and return count. */
  (void)out_xyz;
  (void)max_vertices;
  return 0;
}

/*
 * Export triangular facets as indices into the vertex array.
 *
 * Conventions:
 *  - out_tris must have space for at least 3 * max_facets ints.
 *  - Facet j is stored at out_tris[3*j + 0..2] = (v0, v1, v2), where
 *    v* are 0‑based indices into the vertex list returned by se_get_vertices.
 *  - Returns the number of facets actually written (<= max_facets).
 *
 * Recommended implementation:
 *  - Build a mapping from vertex_id to a compact index [0..N-1] using
 *    loc_ordinal(v) and an auxiliary array.
 *  - Iterate over facets with FOR_ALL_FACETS(f_id) and, for each,
 *    recover its 3 vertices via facetedge / edge helpers.
 */
int se_get_facets(int *out_tris, int max_facets)
{
  if ( out_tris == NULL || max_facets <= 0 )
    return 0;

  /* TODO: fill out_tris with facet vertex indices and return count. */
  (void)out_tris;
  (void)max_facets;
  return 0;
}

/*-----------------------------------------------------------------------------
 *  Simple status helpers (optional)
 *---------------------------------------------------------------------------*/

double se_get_total_energy(void)
{
  /* TODO: read from web.total_energy or recompute as needed. */
  return 0.0;
}

double se_get_total_area(void)
{
  /* TODO: read from web.total_area or recompute as needed. */
  return 0.0;
}

int se_get_dimension(void)
{
  /* Web dimension (surface dimension). */
  return web.dimension;
}

int se_get_space_dim(void)
{
  /* Ambient space dimension. */
  return SDIM;
}

