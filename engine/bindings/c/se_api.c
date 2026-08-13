/*************************************************************
*  Surface Evolver C API  —  se_api.c
*
*  Provides a clean, FFI-friendly facade over the SE runtime
*  for use with Python ctypes (or any other foreign caller).
*
*  Compilation note
*  ────────────────
*  This file must be compiled together with all other SE object
*  files.  The shared-library target in the Makefile is `libse`:
*
*    make libse          →  builds libse.so
*
*  Output produced by SE (via outstring / erroutstring) is
*  silently redirected to in-memory streams.  Call se_pop_output()
*  and se_pop_errout() to retrieve it after each operation.
*************************************************************/

#include "include.h"    /* pulls in every SE header transitively */
#include "se_api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <signal.h>
#include <setjmp.h>

/* ── output capture ───────────────────────────────────────────────────── */
/*
 * POSIX: open_memstream gives us an in-memory FILE* whose buffer/size we can
 * read directly.  Windows (MinGW) has no open_memstream, so we capture into a
 * tmpfile() instead and read it back through cap_size()/cap_copy() — the rest
 * of the code only ever touches the streams through those two helpers.
 */

static char   *cap_out_buf  = NULL;
static size_t  cap_out_size = 0;
static FILE   *cap_out_fd   = NULL;

static char   *cap_err_buf  = NULL;
static size_t  cap_err_size = 0;
static FILE   *cap_err_fd   = NULL;

#ifdef _WIN32
static FILE *cap_open(char **buf, size_t *size)
{
    (void)buf;
    *size = 0;
    return tmpfile();
}
static size_t cap_size(FILE *fd, size_t memsize)
{
    long p;
    (void)memsize;
    fflush(fd);
    p = ftell(fd);
    return p < 0 ? 0 : (size_t)p;
}
/* Copy up to outmax captured bytes into out; leaves the stream position at
 * the end so subsequent writes keep appending. */
static size_t cap_copy(FILE *fd, const char *membuf, size_t memsize,
                       char *out, size_t outmax)
{
    size_t n = cap_size(fd, memsize);
    (void)membuf;
    if (n > outmax) n = outmax;
    rewind(fd);
    n = fread(out, 1, n, fd);
    fseek(fd, 0, SEEK_END);
    return n;
}
#else
static FILE *cap_open(char **buf, size_t *size)
{
    return open_memstream(buf, size);
}
static size_t cap_size(FILE *fd, size_t memsize)
{
    fflush(fd);
    return memsize;
}
static size_t cap_copy(FILE *fd, const char *membuf, size_t memsize,
                       char *out, size_t outmax)
{
    size_t n = cap_size(fd, memsize);
    if (n > outmax) n = outmax;
    memcpy(out, membuf, n);
    return n;
}
#endif

/* Last API-level error description (not the same as SE's errmsg). */
static char se_errmsg_buf[4096];

static int se_initialized = 0;

/* Open (or re-open) both capture streams and point SE's global FILE*
 * pointers at them. */
static void open_capture_streams(void)
{
    cap_out_fd = cap_open(&cap_out_buf, &cap_out_size);
    cap_err_fd = cap_open(&cap_err_buf, &cap_err_size);
    outfd    = cap_out_fd;
    erroutfd = cap_err_fd;
}

/* Flush, close, free, and reopen a single capture stream.
 * *global_fd is updated so SE's outfd / erroutfd stay valid. */
static void reset_cap(FILE **fd, char **buf, size_t *sz, FILE **global_fd)
{
    fflush(*fd);
    fclose(*fd);        /* tmpfile() auto-deletes on close (Windows path) */
    free(*buf);         /* no-op on Windows: buf stays NULL */
    *buf = NULL;
    *sz  = 0;
    *fd  = cap_open(buf, sz);
    if (global_fd)
        *global_fd = *fd;
}

/* ── se_init ──────────────────────────────────────────────────────────── */

int se_init(void)
{
    if (se_initialized)
        return 0;

    /* message buffer used by SE's sprintf-based output helpers */
    msgmax = 2000;
    if (!msg)
        msg = my_list_calloc(1, msgmax, ETERNAL_BLOCK);

    set_ctypes();   /* ctype tables used by the parser */

    /* compute machine epsilon, precision constants */
    { REAL eps, one = 1.0;
      for (eps = 1.0; one + eps != one; eps /= 2.0);
      machine_eps      = 2.0 * eps;
      root8machine_eps = sqrt(sqrt(sqrt((double)machine_eps)));
      DPREC            = (int)floor(-log((double)machine_eps) / log(10.0));
      DWIDTH           = DPREC + 3;
    }

    if (sizeof(element_id) > sizeof(REAL)) {
        snprintf(se_errmsg_buf, sizeof(se_errmsg_buf),
                 "Bad datatype sizes: element_id (%zu bytes) > REAL (%zu bytes)",
                 sizeof(element_id), sizeof(REAL));
        return -1;
    }

    /* redirect SE output to in-memory buffers */
    open_capture_streams();

    /* SE internal initializations that main() performs */
    print_express(NULL, 0);   /* initialise string-expression allocation */
    find_cpu_speed();
    scoeff_init();            /* 1-D Gaussian integration coefficients   */
    vcoeff_init();            /* volume integration coefficients          */

    /* set up single-thread data structure (non-threaded path) */
    if (!thread_data_ptrs) {
        thread_data_ptrs    = &default_thread_data_ptr;
        thread_data_ptrs[0] = &default_thread_data;
    }

    /* signal handlers – mirrors what main() installs */
    signal(SIGINT, catcher);
#ifdef SIGUSR1
    signal(SIGUSR1, catcher);
#endif
#ifdef SIGTERM
    signal(SIGTERM, catcher);
#endif
#ifdef SIGHUP
    signal(SIGHUP, catcher);
#endif
#ifdef SIGPIPE
    signal(SIGPIPE, catcher);
#endif

    /* prime the error-recovery jump target so kb_error longjmps land
     * somewhere safe rather than into uninitialised stack memory */
    subshell_depth = 0;
    setjmp(jumpbuf[0]);

    se_errmsg_buf[0] = '\0';
    se_initialized   = 1;
    return 0;
}

/* ── se_load ──────────────────────────────────────────────────────────── */

int se_load(const char *filename)
{
    if (!se_initialized)
        return -1;

    /* kb_error(UNRECOVERABLE,...) longjmps to jumpbuf[subshell_depth].
     * Catch it here so the caller gets a clean error return. */
    subshell_depth = 0;
    if (setjmp(jumpbuf[0]) != 0) {
        fflush(cap_out_fd);
        snprintf(se_errmsg_buf, sizeof(se_errmsg_buf),
                 "Error loading '%s'", filename ? filename : "(null)");
        return -1;
    }

    /* startup() resets global web state, opens and parses the .fe file */
    startup((char *)filename);

    /* ensure energy / area / volumes are computed */
    recalc();

    /* If startup produced error output and loaded no vertices, report failure */
    if (cap_size(cap_err_fd, cap_err_size) > 0 && web.skel[VERTEX].count == 0) {
        int n = (int)cap_copy(cap_err_fd, cap_err_buf, cap_err_size,
                              se_errmsg_buf, sizeof(se_errmsg_buf) - 1);
        while (n > 0 && (se_errmsg_buf[n-1] == '\n' || se_errmsg_buf[n-1] == '\r'))
            n--;
        se_errmsg_buf[n] = '\0';
        return -1;
    }

    /* Soapfilm only. STRING facets are polygons with any number of edges and
     * SIMPLEX cells are k-simplices; se_get_facets() can express neither, so
     * those surfaces would draw as a bare edge web or as nothing at all.
     * Reject at load rather than render a lie. `se_run("...")` is unaffected —
     * this gate is about what we can *draw*, not what the engine can compute. */
    if (web.representation != SOAPFILM) {
        snprintf(se_errmsg_buf, sizeof(se_errmsg_buf),
                 "Unsupported model: this build renders the soapfilm "
                 "(2-D triangulated) model only, but '%s' declares %s.",
                 filename ? filename : "(null)",
                 web.representation == STRING ? "STRING" : "SIMPLEX");
        return -1;
    }

    se_errmsg_buf[0] = '\0';
    return 0;
}

/* ── se_run ───────────────────────────────────────────────────────────── */

int se_run(const char *cmd)
{
    if (!se_initialized || !cmd)
        return -1;

    /* Establish a fresh jumpbuf[0] so that RECOVERABLE errors (which call
     * longjmp(jumpbuf[subshell_depth], 1) from kb_error's bailout path)
     * land here rather than in a stale stack frame from se_load().
     * kb_error's bailout also closes our capture streams and resets
     * outfd/erroutfd to stdout/stderr, so we must re-open them on error. */
    subshell_depth = 0;
    if (setjmp(jumpbuf[0]) != 0) {
        /* A RECOVERABLE error escaped command()'s cmdbuf handler.
         * Flush and save errout content BEFORE reopening streams (which
         * would discard it), so the caller can see the actual SE error. */
        if (cap_size(cap_err_fd, cap_err_size) > 0) {
            int n = (int)cap_copy(cap_err_fd, cap_err_buf, cap_err_size,
                                  se_errmsg_buf, sizeof(se_errmsg_buf) - 1);
            /* strip trailing newline for cleaner messages */
            while (n > 0 && (se_errmsg_buf[n-1] == '\n' ||
                             se_errmsg_buf[n-1] == '\r'))
                n--;
            se_errmsg_buf[n] = '\0';
        } else {
            snprintf(se_errmsg_buf, sizeof(se_errmsg_buf),
                     "SE error during command: %s", cmd);
        }
        /* Re-establish the capture streams that kb_error's bailout closed. */
        open_capture_streams();
        return -1;
    }

    /* old_menu() calls command() which has its own cmdbuf setjmp for
     * parse/command errors, then calls recalc() if change_flag is set.
     * command() returns 1 on normal success, 0 on parse/runtime error,
     * END_COMMANDS on quit.  Normalise to POSIX: 0 = success, -1 = error. */
    int retval = old_menu((char *)cmd);
    return (retval == 1) ? 0 : -1;
}

/* ── scalar state accessors ───────────────────────────────────────────── */

double se_get_energy(void) { return (double)web.total_energy; }
double se_get_area(void)   { return (double)web.total_area;   }
double se_get_scale(void)  { return (double)web.scale;        }

int se_get_sdim(void)         { return web.sdim; }
int se_get_vertex_count(void) { return (int)web.skel[VERTEX].count; }
int se_get_edge_count(void)   { return (int)web.skel[EDGE].count;   }
int se_get_facet_count(void)  { return (int)web.skel[FACET].count;  }
int se_get_body_count(void)   { return web.bodycount;               }

/* ── se_get_vertices ──────────────────────────────────────────────────── */

int se_get_vertices(double *out, int max_count)
{
    vertex_id v_id;
    int sdim = web.sdim;
    int n    = 0;

    if (!se_initialized || !out || max_count <= 0)
        return -1;

    /* Always emit exactly 3 components per vertex so the stride-3 caller is
       correct for any space dimension: pad z=0 for sdim<3 (2-D models render
       flat), keep the first 3 coords for sdim>3 (e.g. simplex sdim=4). */
    FOR_ALL_VERTICES(v_id) {
        REAL *x = get_coord(v_id);
        int j;
        if (n >= max_count)
            break;
        for (j = 0; j < 3; j++)
            out[n * 3 + j] = (j < sdim) ? (double)x[j] : 0.0;
        n++;
    }
    return n;
}

/* ── se_get_vertex_ids ────────────────────────────────────────────────── */

int se_get_vertex_ids(int *ids, int max_count)
{
    vertex_id v_id;
    int n = 0;

    if (!se_initialized || !ids || max_count <= 0)
        return -1;

    FOR_ALL_VERTICES(v_id) {
        if (n >= max_count)
            break;
        ids[n++] = ordinal(v_id) + 1;  /* 1-based, matching SE display */
    }
    return n;
}

/* ── se_get_facets ────────────────────────────────────────────────────── */

int se_get_facets(int *out, int max_count)
{
    facet_id f_id;
    vertex_id v_id;
    int n = 0;
    int max_ord = 0;
    int *ord_to_pos = NULL;
    int pos;

    if (!se_initialized || !out || max_count <= 0)
        return -1;
    /* STRING/SIMPLEX models carry no triangulated facets — report zero
     * (not an error) so curve files render via se_get_edges() instead. */
    if (web.representation != SOAPFILM)
        return 0;

    /* Build ordinal→position map so indices match se_get_vertices() order.
     * Ordinals can have gaps after vertex deletions. */
    FOR_ALL_VERTICES(v_id) {
        int ord = ordinal(v_id);
        if (ord > max_ord) max_ord = ord;
    }
    ord_to_pos = (int *)calloc(max_ord + 1, sizeof(int));
    if (!ord_to_pos)
        return -1;
    pos = 0;
    FOR_ALL_VERTICES(v_id) {
        ord_to_pos[ordinal(v_id)] = pos++;
    }

    FOR_ALL_FACETS(f_id) {
        facetedge_id fe;
        int verts[3];
        int k;

        if (n >= max_count)
            break;
        if (inverted(f_id))
            continue;

        fe = get_facet_fe(f_id);
        if (!valid_id(fe))
            continue;

        for (k = 0; k < 3; k++) {
            int ord = ordinal(get_fe_tailv(fe));
            verts[k] = ord_to_pos[ord];  /* sequential position in vertex buf */
            fe = get_next_edge(fe);      /* next edge around this facet */
        }
        out[n * 3 + 0] = verts[0];
        out[n * 3 + 1] = verts[1];
        out[n * 3 + 2] = verts[2];
        n++;
    }
    free(ord_to_pos);
    return n;
}

/* ── se_get_edges ─────────────────────────────────────────────────────── */
/*
 * Two vertex positions per edge, packed [t0,h0, t1,h1, ...].  Positions are
 * sequential indices matching se_get_vertices() row order (same ordinal→pos
 * map se_get_facets uses).  Works for every representation — this is the only
 * geometry the STRING (1-D) model produces, so no SOAPFILM guard here.
 */
int se_get_edges(int *out, int max_count)
{
    edge_id   e_id;
    vertex_id v_id;
    int n = 0, max_ord = 0, pos;
    int *ord_to_pos = NULL;

    if (!se_initialized || !out || max_count <= 0)
        return -1;

    FOR_ALL_VERTICES(v_id) {
        int ord = ordinal(v_id);
        if (ord > max_ord) max_ord = ord;
    }
    ord_to_pos = (int *)calloc((size_t)(max_ord + 1), sizeof(int));
    if (!ord_to_pos)
        return -1;
    pos = 0;
    FOR_ALL_VERTICES(v_id)
        ord_to_pos[ordinal(v_id)] = pos++;

    FOR_ALL_EDGES(e_id) {
        vertex_id tv, hv;
        if (n >= max_count)
            break;
        tv = get_edge_tailv(e_id);
        hv = get_edge_headv(e_id);
        if (!valid_id(tv) || !valid_id(hv))
            continue;
        out[n * 2 + 0] = ord_to_pos[ordinal(tv)];
        out[n * 2 + 1] = ord_to_pos[ordinal(hv)];
        n++;
    }
    free(ord_to_pos);
    return n;
}

/* ── se_get_facet_colors ──────────────────────────────────────────────── */
/* SE colour-table index for each facet's front and back, in the same row order
 * as se_get_facets (non-inverted facets only).  Either array may be NULL.
 * Returns facet count written, or -1.  Colour CLEAR is -1. */
int se_get_facet_colors(int *front, int *back, int max_count)
{
    facet_id f_id;
    int n = 0;
    if (!se_initialized || max_count <= 0)
        return -1;
    /* Convention: 0 = "not applicable to this representation", -1 = bad args.
     * Kept separate from the argument check above, which used to be conflated
     * with it and reported a wrong model as a caller error. */
    if (web.representation != SOAPFILM)
        return 0;
    FOR_ALL_FACETS(f_id) {
        facetedge_id fe;
        if (inverted(f_id)) continue;
        fe = get_facet_fe(f_id);
        if (!valid_id(fe)) continue;
        if (n >= max_count) break;
        if (front) front[n] = get_facet_frontcolor(f_id);
        if (back)  back[n]  = get_facet_backcolor(f_id);
        n++;
    }
    return n;
}


/* ── se_get_edge_colors / lengths / densities ─────────────────────────── */
/* All three iterate edges in se_get_edges row order (valid endpoints only). */
int se_get_edge_colors(int *out, int max_count)
{
    edge_id e_id;
    int n = 0;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    FOR_ALL_EDGES(e_id) {
        if (!valid_id(get_edge_tailv(e_id)) || !valid_id(get_edge_headv(e_id))) continue;
        if (n >= max_count) break;
        out[n++] = get_edge_color(e_id);
    }
    return n;
}

/* ── periodicity ──────────────────────────────────────────────────────── */
/*
 * Per-edge wrap code, in se_get_edges() row order (same FOR_ALL_EDGES walk and
 * the same validity filter, so index i lines up across all three accessors).
 *
 * 0 means the edge does not cross a period boundary.  Non-zero packs 6 bits
 * per dimension (see torus.c); callers that only need "is this edge wrapped"
 * can test against 0 and ignore the encoding.
 *
 * Returns the number written, 0 if the surface is not periodic, -1 on error.
 *
 * The gate is web.symmetry_flag rather than web.torus_flag on purpose:
 * E_WRAP_ATTR is only given storage by expand_attribute(EDGE,...) when a
 * symmetry group is in effect (lexinit.c), so calling get_edge_wrap() on a
 * plain surface reads a zero-length attribute slot.
 */
int se_get_edge_wraps(int *out, int max_count)
{
    edge_id e_id;
    int n = 0;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    if (!web.symmetry_flag)
        return 0;
    FOR_ALL_EDGES(e_id) {
        if (!valid_id(get_edge_tailv(e_id)) || !valid_id(get_edge_headv(e_id))) continue;
        if (n >= max_count) break;
        out[n++] = (int)get_edge_wrap(e_id);
    }
    return n;
}


/* ── se_get_bounding_box ──────────────────────────────────────────────── */
/*
 * Axis-aligned bounds of the current surface, min[] and max[] over sdim
 * coordinates.  Computed directly from vertex positions.
 *
 * The engine has its own bounding_box global, but it is filled by graphgen()
 * (graphgen.c:269, 955-1024), and nothing in this facade ever calls graphgen —
 * so it stays at its initial value.  Note the graphics pipeline *is* linked
 * into libse: CMakeLists builds SE_GRAPHICS_COMMON unconditionally and
 * SE_HEADLESS only swaps the backend (xgraph.c -> nulgraph.c).  Linked but
 * never invoked, which is not the same as absent.
 *
 * Returns sdim on success, -1 on error, 0 if no vertices.
 */
int se_get_bounding_box(double *out_min, double *out_max)
{
    vertex_id v_id;
    int sdim = web.sdim;
    int j, any = 0;

    if (!se_initialized || !out_min || !out_max)
        return -1;

    for (j = 0; j < sdim; j++) {
        out_min[j] =  1e30;
        out_max[j] = -1e30;
    }

    FOR_ALL_VERTICES(v_id) {
        REAL *x = get_coord(v_id);
        any = 1;
        for (j = 0; j < sdim; j++) {
            double c = (double)x[j];
            if (c < out_min[j]) out_min[j] = c;
            if (c > out_max[j]) out_max[j] = c;
        }
    }
    if (!any) {
        for (j = 0; j < sdim; j++) { out_min[j] = 0.0; out_max[j] = 0.0; }
        return 0;
    }
    return sdim;
}

/* ── se_get_lagrange_order ────────────────────────────────────────────── */
/* Polynomial order of elements.  >1 means edge-midpoint control vertices are
 * present and the linear-triangle render is geometrically wrong — UI should
 * warn.  Returns web.lagrange_order, or -1 if uninitialised. */
int se_get_lagrange_order(void)
{
    if (!se_initialized)
        return -1;
    return web.lagrange_order;
}


/* ── se_get_body_volumes ──────────────────────────────────────────────── */

int se_get_body_volumes(double *volumes, double *pressures, int max_count)
{
    body_id b_id;
    int n = 0;

    if (!se_initialized || max_count <= 0)
        return -1;

    FOR_ALL_BODIES(b_id) {
        if (n >= max_count)
            break;
        if (volumes)   volumes[n]   = (double)get_body_volume(b_id);
        if (pressures) pressures[n] = (double)get_body_pressure(b_id);
        n++;
    }
    return n;
}

/* ── se_get_topo_counts ───────────────────────────────────────────────── */
/* Cumulative topology-operation counters (they accumulate over the session;
 * diff before/after a command for per-command deltas).  Fixed order:
 *   0 equi  1 edge_refine  2 facet_refine  3 vertex_dissolve  4 edge_dissolve
 *   5 facet_dissolve  6 vertex_pop  7 edge_pop  8 edgeswap  9 fix  10 unfix
 * Returns number written (<= SE_TOPO_COUNT), or -1 on error. */
int se_get_topo_counts(int *out, int max_count)
{
    int vals[SE_TOPO_COUNT];
    int i, n;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    vals[0]  = web.equi_count;
    vals[1]  = web.edge_refine_count;
    vals[2]  = web.facet_refine_count;
    vals[3]  = web.vertex_dissolve_count;
    vals[4]  = web.edge_dissolve_count;
    vals[5]  = web.facet_dissolve_count;
    vals[6]  = web.vertex_pop_count;
    vals[7]  = web.edge_pop_count;
    vals[8]  = web.edgeswap_count;
    vals[9]  = web.fix_count;
    vals[10] = web.unfix_count;
    n = (max_count < SE_TOPO_COUNT) ? max_count : SE_TOPO_COUNT;
    for (i = 0; i < n; i++)
        out[i] = vals[i];
    return n;
}

/* ── se_get_body_cm ───────────────────────────────────────────────────── */
/*
 * Volume-weighted centre of mass of the body at ordinal `body_idx`.
 *
 * The engine's bptr->cm field is written only by graphgen() (graphgen.c:2467),
 * which this facade never calls, so we compute it directly: decompose the
 * body's bounding surface into tetrahedra (origin, a, b, c) per oriented facet.
 *   signed tet volume  v = a·(b×c)/6
 *   tet centroid          (a+b+c)/4
 *   body centroid = Σ v·centroid / Σ v
 * Each facet bounds get_facet_body(f) on one side and the inverse on the other;
 * contributions are signed so only the net (closed) body volume survives.
 * SOAPFILM + sdim 3 only.  Fills out_xyz[0..2]; returns 3, 0 if the surface is
 * not SOAPFILM/sdim-3 (not applicable, not an error), or -1 on bad arguments /
 * out-of-range / degenerate (near-zero volume).
 */
int se_get_body_cm(int body_idx, double *out_xyz)
{
    body_id  target = NULLID, b_id;
    facet_id f_id;
    int n = 0, k;
    double V = 0.0, M[3] = {0, 0, 0};

    if (!se_initialized || !out_xyz || body_idx < 0)
        return -1;
    if (web.representation != SOAPFILM || web.sdim != 3)
        return 0;   /* not applicable — see the convention note above */

    FOR_ALL_BODIES(b_id) {
        if (n == body_idx) { target = b_id; break; }
        n++;
    }
    if (!valid_id(target))
        return -1;

    FOR_ALL_FACETS(f_id) {
        facetedge_id fe;
        REAL *p[3];
        double a[3], b[3], c[3], cross[3], v, sign;
        body_id bf, bb;

        if (inverted(f_id)) continue;
        fe = get_facet_fe(f_id);
        if (!valid_id(fe)) continue;

        bf = get_facet_body(f_id);
        bb = get_facet_body(inverse_id(f_id));
        if (equal_id(bf, target))      sign =  1.0;
        else if (equal_id(bb, target)) sign = -1.0;
        else continue;

        for (k = 0; k < 3; k++) { p[k] = get_coord(get_fe_tailv(fe)); fe = get_next_edge(fe); }
        for (k = 0; k < 3; k++) { a[k] = (double)p[0][k]; b[k] = (double)p[1][k]; c[k] = (double)p[2][k]; }

        cross[0] = b[1]*c[2] - b[2]*c[1];
        cross[1] = b[2]*c[0] - b[0]*c[2];
        cross[2] = b[0]*c[1] - b[1]*c[0];
        v = sign * (a[0]*cross[0] + a[1]*cross[1] + a[2]*cross[2]) / 6.0;

        V += v;
        for (k = 0; k < 3; k++)
            M[k] += v * (a[k] + b[k] + c[k]) / 4.0;
    }

    if (fabs(V) < 1e-15)
        return -1;
    for (k = 0; k < 3; k++)
        out_xyz[k] = M[k] / V;
    return 3;
}

/* ── se_get_vertex_info (element inspector) ────────────────────────────── */
/*
 * Detail for the vertex at sequential position `vpos` (matching se_get_vertices
 * row order).  out_id ← 1-based SE ordinal; out_xyz ← sdim coords; out_attr ←
 * the attribute bitmap (FIXED 0x40, BOUNDARY 0x80, CONSTRAINT 0x400, …);
 * out_cons ← active constraint indices (up to cons_max).  Any out param may be
 * NULL.  Returns the number of constraints on the vertex (may exceed cons_max),
 * or -1 on error / out-of-range.
 */
int se_get_vertex_info(int vpos, int *out_id, double *out_xyz, int *out_attr,
                       int *out_cons, int cons_max)
{
    vertex_id v_id = NULLID;
    int n = 0, sdim = web.sdim, j, found = 0;
    conmap_t *cm;
    int count, w;

    if (!se_initialized || vpos < 0)
        return -1;
    FOR_ALL_VERTICES(v_id) {
        if (n == vpos) { found = 1; break; }
        n++;
    }
    if (!found || !valid_id(v_id))
        return -1;

    if (out_id)  *out_id  = ordinal(v_id) + 1;
    if (out_xyz) { REAL *x = get_coord(v_id); for (j = 0; j < 3; j++) out_xyz[j] = (j < sdim) ? (double)x[j] : 0.0; }
    if (out_attr) *out_attr = (int)get_attr(v_id);

    cm    = get_v_constraint_map(v_id);
    count = (int)cm[0];
    for (j = 1, w = 0; j <= count; j++, w++) {
        if (out_cons && w < cons_max)
            out_cons[w] = (int)(cm[j] & CONMASK);
    }
    return count;
}

/* ── se_get_constraint_name ───────────────────────────────────────────── */
/* Name of constraint `con_idx` (1..web.highcon) → buf.  Returns 0, or -1 on
 * out-of-range / error. */
int se_get_constraint_name(int con_idx, char *buf, int size)
{
    if (!se_initialized || !buf || size <= 0 || con_idx < 1 || con_idx > web.highcon)
        return -1;
    strncpy(buf, GETCONSTR(con_idx)->name, (size_t)size - 1);
    buf[size - 1] = '\0';
    return 0;
}


/* ── output capture helpers ───────────────────────────────────────────── */

int se_pop_output(char *buf, int bufsize)
{
    int n;
    if (!buf || bufsize <= 0)
        return -1;
    n = (int)cap_copy(cap_out_fd, cap_out_buf, cap_out_size,
                      buf, (size_t)(bufsize - 1));
    buf[n] = '\0';
    reset_cap(&cap_out_fd, &cap_out_buf, &cap_out_size, &outfd);
    return n;
}

int se_pop_errout(char *buf, int bufsize)
{
    int n;
    if (!buf || bufsize <= 0)
        return -1;
    n = (int)cap_copy(cap_err_fd, cap_err_buf, cap_err_size,
                      buf, (size_t)(bufsize - 1));
    buf[n] = '\0';
    reset_cap(&cap_err_fd, &cap_err_buf, &cap_err_size, &erroutfd);
    return n;
}

const char *se_last_error(void)
{
    return se_errmsg_buf;
}
