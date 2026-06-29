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

static char   *cap_out_buf  = NULL;
static size_t  cap_out_size = 0;
static FILE   *cap_out_fd   = NULL;

static char   *cap_err_buf  = NULL;
static size_t  cap_err_size = 0;
static FILE   *cap_err_fd   = NULL;

/* Last API-level error description (not the same as SE's errmsg). */
static char se_errmsg_buf[4096];

static int se_initialized = 0;

/* Open (or re-open) both capture streams and point SE's global FILE*
 * pointers at them. */
static void open_capture_streams(void)
{
    cap_out_fd = open_memstream(&cap_out_buf, &cap_out_size);
    cap_err_fd = open_memstream(&cap_err_buf, &cap_err_size);
    outfd    = cap_out_fd;
    erroutfd = cap_err_fd;
}

/* Flush, close, free, and reopen a single capture stream.
 * *global_fd is updated so SE's outfd / erroutfd stay valid. */
static void reset_cap(FILE **fd, char **buf, size_t *sz, FILE **global_fd)
{
    fflush(*fd);
    fclose(*fd);
    free(*buf);
    *buf = NULL;
    *sz  = 0;
    *fd  = open_memstream(buf, sz);
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
    fflush(cap_err_fd);
    if (cap_err_size > 0 && web.skel[VERTEX].count == 0) {
        int n = (int)(cap_err_size < sizeof(se_errmsg_buf) - 1
                      ? cap_err_size : sizeof(se_errmsg_buf) - 1);
        memcpy(se_errmsg_buf, cap_err_buf, n);
        while (n > 0 && (se_errmsg_buf[n-1] == '\n' || se_errmsg_buf[n-1] == '\r'))
            n--;
        se_errmsg_buf[n] = '\0';
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
        fflush(cap_err_fd);
        if (cap_err_size > 0) {
            int n = (int)(cap_err_size < sizeof(se_errmsg_buf) - 1
                          ? cap_err_size : sizeof(se_errmsg_buf) - 1);
            memcpy(se_errmsg_buf, cap_err_buf, n);
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

void se_set_scale(double s)
{
    web.scale = (REAL)s;
}

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

    FOR_ALL_VERTICES(v_id) {
        REAL *x = get_coord(v_id);
        int j;
        if (n >= max_count)
            break;
        for (j = 0; j < sdim; j++)
            out[n * sdim + j] = (double)x[j];
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
    if (!se_initialized || max_count <= 0 || web.representation != SOAPFILM)
        return -1;
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

/* ── se_get_facet_normals ─────────────────────────────────────────────── */
/* Engine outward normal per facet (handles inverted facets / lagrange order),
 * packed [nx,ny,nz, ...] in se_get_facets row order.  SOAPFILM + sdim 3.
 * Returns facet count written, or -1. */
int se_get_facet_normals(double *out, int max_count)
{
    facet_id f_id;
    int n = 0, j;
    if (!se_initialized || !out || max_count <= 0 ||
        web.representation != SOAPFILM || web.sdim != 3)
        return -1;
    FOR_ALL_FACETS(f_id) {
        facetedge_id fe;
        REAL nrm[MAXCOORD];
        if (inverted(f_id)) continue;
        fe = get_facet_fe(f_id);
        if (!valid_id(fe)) continue;
        if (n >= max_count) break;
        get_facet_normal(f_id, nrm);   /* engine normal is not unit-length */
        {
            double mag = sqrt((double)(nrm[0]*nrm[0] + nrm[1]*nrm[1] + nrm[2]*nrm[2]));
            if (mag < 1e-30) mag = 1.0;
            for (j = 0; j < 3; j++)
                out[n * 3 + j] = (double)nrm[j] / mag;
        }
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

int se_get_edge_lengths(double *out, int max_count)
{
    edge_id e_id;
    int n = 0;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    FOR_ALL_EDGES(e_id) {
        if (!valid_id(get_edge_tailv(e_id)) || !valid_id(get_edge_headv(e_id))) continue;
        if (n >= max_count) break;
        out[n++] = (double)get_edge_length(e_id);
    }
    return n;
}

int se_get_edge_densities(double *out, int max_count)
{
    edge_id e_id;
    int n = 0;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    FOR_ALL_EDGES(e_id) {
        if (!valid_id(get_edge_tailv(e_id)) || !valid_id(get_edge_headv(e_id))) continue;
        if (n >= max_count) break;
        out[n++] = (double)get_edge_density(e_id);
    }
    return n;
}

/* ── se_get_bounding_box ──────────────────────────────────────────────── */
/*
 * Axis-aligned bounds of the current surface, min[] and max[] over sdim
 * coordinates.  Computed directly from vertex positions (the engine's own
 * bounding_box global lives in the graphics pipeline, which is absent in the
 * headless build).  Returns sdim on success, -1 on error, 0 if no vertices.
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

/* ── se_get_vertex_mean_curvatures ────────────────────────────────────── */
/*
 * Discrete mean curvature at each vertex via the cotangent-Laplacian.
 *
 * For each triangle (p0,p1,p2) the contributions are:
 *   vertex p0: cot2*(p1-p0) + cot1*(p2-p0)
 *   vertex p1: cot2*(p0-p1) + cot0*(p2-p1)
 *   vertex p2: cot1*(p0-p2) + cot0*(p1-p2)
 * where cotN is cot(angle at pN) = dot/|cross|.
 *
 * Mixed area per vertex per triangle = face_area / 3 (barycentric).
 *
 * H_i = |L_i| / (2 * A_i)
 */
int se_get_vertex_mean_curvatures(double *out, int max_count)
{
    vertex_id v_id;
    facet_id  f_id;
    int nv, max_ord, n, k;
    int *pos_map = NULL;
    double *Lx = NULL, *Ly = NULL, *Lz = NULL, *A = NULL;

    if (!se_initialized || !out || max_count <= 0)
        return -1;
    if (web.representation != SOAPFILM || web.sdim != 3)
        return -1;

    nv = (int)web.skel[VERTEX].count;
    if (nv == 0)
        return 0;

    /* Build ordinal → sequential position map */
    max_ord = 0;
    FOR_ALL_VERTICES(v_id) {
        int ord = ordinal(v_id);
        if (ord > max_ord) max_ord = ord;
    }
    pos_map = (int *)calloc((size_t)(max_ord + 1), sizeof(int));
    if (!pos_map) return -1;
    n = 0;
    FOR_ALL_VERTICES(v_id)
        pos_map[ordinal(v_id)] = n++;

    /* Per-vertex accumulators */
    Lx = (double *)calloc((size_t)nv, sizeof(double));
    Ly = (double *)calloc((size_t)nv, sizeof(double));
    Lz = (double *)calloc((size_t)nv, sizeof(double));
    A  = (double *)calloc((size_t)nv, sizeof(double));
    if (!Lx || !Ly || !Lz || !A) {
        free(pos_map); free(Lx); free(Ly); free(Lz); free(A);
        return -1;
    }

    /* Accumulate cotangent-Laplacian from every non-inverted triangle */
    FOR_ALL_FACETS(f_id) {
        facetedge_id fe0, fe1, fe2;
        vertex_id v0, v1, v2;
        REAL *p0, *p1, *p2;
        double e01[3], e02[3], e10[3], e12[3], e20[3], e21[3];
        double cx, cy, cz, cross_len;
        double cot0, cot1, cot2;
        int pos0, pos1, pos2;

        if (inverted(f_id)) continue;
        fe0 = get_facet_fe(f_id);
        if (!valid_id(fe0)) continue;
        fe1 = get_next_edge(fe0);
        fe2 = get_next_edge(fe1);

        v0 = get_fe_tailv(fe0);
        v1 = get_fe_tailv(fe1);
        v2 = get_fe_tailv(fe2);
        p0 = get_coord(v0);
        p1 = get_coord(v1);
        p2 = get_coord(v2);

        for (k = 0; k < 3; k++) {
            e01[k] = (double)(p1[k] - p0[k]);
            e02[k] = (double)(p2[k] - p0[k]);
            e10[k] = -e01[k];
            e12[k] = (double)(p2[k] - p1[k]);
            e20[k] = -e02[k];
            e21[k] = -e12[k];
        }

        /* |e01 × e02| = 2 * triangle_area */
        cx = e01[1]*e02[2] - e01[2]*e02[1];
        cy = e01[2]*e02[0] - e01[0]*e02[2];
        cz = e01[0]*e02[1] - e01[1]*e02[0];
        cross_len = sqrt(cx*cx + cy*cy + cz*cz);
        if (cross_len < 1e-15) continue;

        /* cot(angle) = dot(edges) / |cross|  (denominator = 2*area, same for all) */
        cot0 = (e01[0]*e02[0] + e01[1]*e02[1] + e01[2]*e02[2]) / cross_len;
        cot1 = (e10[0]*e12[0] + e10[1]*e12[1] + e10[2]*e12[2]) / cross_len;
        cot2 = (e20[0]*e21[0] + e20[1]*e21[1] + e20[2]*e21[2]) / cross_len;

        pos0 = pos_map[ordinal(v0)];
        pos1 = pos_map[ordinal(v1)];
        pos2 = pos_map[ordinal(v2)];

        /* Barycentric mixed area: area/3 per vertex; cross_len = 2*area */
        A[pos0] += cross_len / 6.0;
        A[pos1] += cross_len / 6.0;
        A[pos2] += cross_len / 6.0;

        /* Laplacian contributions (opposite-angle cotangents × edge direction) */
        Lx[pos0] += cot2*(p1[0]-p0[0]) + cot1*(p2[0]-p0[0]);
        Ly[pos0] += cot2*(p1[1]-p0[1]) + cot1*(p2[1]-p0[1]);
        Lz[pos0] += cot2*(p1[2]-p0[2]) + cot1*(p2[2]-p0[2]);

        Lx[pos1] += cot2*(p0[0]-p1[0]) + cot0*(p2[0]-p1[0]);
        Ly[pos1] += cot2*(p0[1]-p1[1]) + cot0*(p2[1]-p1[1]);
        Lz[pos1] += cot2*(p0[2]-p1[2]) + cot0*(p2[2]-p1[2]);

        Lx[pos2] += cot1*(p0[0]-p2[0]) + cot0*(p1[0]-p2[0]);
        Ly[pos2] += cot1*(p0[1]-p2[1]) + cot0*(p1[1]-p2[1]);
        Lz[pos2] += cot1*(p0[2]-p2[2]) + cot0*(p1[2]-p2[2]);
    }

    /* H_i = |L_i| / (2 * A_i) */
    n = 0;
    FOR_ALL_VERTICES(v_id) {
        int pos;
        double lx, ly, lz, area;
        if (n >= max_count) break;
        pos  = pos_map[ordinal(v_id)];
        lx   = Lx[pos]; ly = Ly[pos]; lz = Lz[pos];
        area = A[pos];
        out[n++] = (area > 1e-15) ? sqrt(lx*lx + ly*ly + lz*lz) / (2.0 * area) : 0.0;
    }

    free(pos_map); free(Lx); free(Ly); free(Lz); free(A);
    return n;
}

/* Allocate + fill an ordinal→sequential-position map for vertices (matching
 * se_get_vertices row order).  Caller frees.  Returns NULL on OOM. */
static int *build_vertex_pos_map(void)
{
    vertex_id v_id;
    int max_ord = 0, pos = 0;
    int *m;
    FOR_ALL_VERTICES(v_id) { int o = ordinal(v_id); if (o > max_ord) max_ord = o; }
    m = (int *)calloc((size_t)(max_ord + 1), sizeof(int));
    if (!m) return NULL;
    FOR_ALL_VERTICES(v_id) m[ordinal(v_id)] = pos++;
    return m;
}

/* ── se_get_vertex_valences ───────────────────────────────────────────── */
/* Incident-edge count per vertex (regular triangular meshes are 6).  Counted
 * directly from the edge list — the engine's cached vptr->valence field is not
 * populated on a freshly loaded surface. */
int se_get_vertex_valences(int *out, int max_count)
{
    edge_id   e_id;
    vertex_id v_id;
    int nv, n = 0;
    int *pos_map, *cnt;

    if (!se_initialized || !out || max_count <= 0)
        return -1;
    nv = (int)web.skel[VERTEX].count;
    if (nv == 0) return 0;

    pos_map = build_vertex_pos_map();
    if (!pos_map) return -1;
    cnt = (int *)calloc((size_t)nv, sizeof(int));
    if (!cnt) { free(pos_map); return -1; }

    FOR_ALL_EDGES(e_id) {
        vertex_id tv = get_edge_tailv(e_id), hv = get_edge_headv(e_id);
        if (valid_id(tv)) cnt[pos_map[ordinal(tv)]]++;
        if (valid_id(hv)) cnt[pos_map[ordinal(hv)]]++;
    }

    FOR_ALL_VERTICES(v_id) {
        if (n >= max_count) break;
        out[n] = cnt[pos_map[ordinal(v_id)]];
        n++;
    }
    free(pos_map); free(cnt);
    return n;
}

/* ── se_get_vertex_star_areas ─────────────────────────────────────────── */
/* Mixed (barycentric) area of the facet star around each vertex. */
int se_get_vertex_star_areas(double *out, int max_count)
{
    vertex_id v_id;
    int n = 0;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    FOR_ALL_VERTICES(v_id) {
        if (n >= max_count) break;
        out[n++] = (double)get_vertex_area_star(v_id);
    }
    return n;
}

/* ── se_get_vertex_force_mags ─────────────────────────────────────────── */
/* Magnitude of the per-vertex force / descent direction (populated after an
 * iteration; zero on a freshly loaded surface).  Highlights high-tension
 * regions. */
int se_get_vertex_force_mags(double *out, int max_count)
{
    vertex_id v_id;
    int sdim = web.sdim, n = 0, j;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    FOR_ALL_VERTICES(v_id) {
        REAL *f = get_force(v_id);
        double s = 0.0;
        if (n >= max_count) break;
        for (j = 0; j < sdim; j++) s += (double)f[j] * (double)f[j];
        out[n++] = sqrt(s);
    }
    return n;
}

/* ── se_get_vertex_energy_density ─────────────────────────────────────── */
/* Vertex-averaged surface energy: each facet contributes area×density, split
 * evenly (÷3) among its three corner vertices.  A direct energy-density proxy.
 * SOAPFILM only (needs triangulated facets). */
int se_get_vertex_energy_density(double *out, int max_count)
{
    vertex_id v_id;
    facet_id  f_id;
    int nv, n;
    int *pos_map;
    double *acc;

    if (!se_initialized || !out || max_count <= 0)
        return -1;
    if (web.representation != SOAPFILM)
        return 0;

    nv = (int)web.skel[VERTEX].count;
    if (nv == 0) return 0;

    pos_map = build_vertex_pos_map();
    if (!pos_map) return -1;
    acc = (double *)calloc((size_t)nv, sizeof(double));
    if (!acc) { free(pos_map); return -1; }

    FOR_ALL_FACETS(f_id) {
        facetedge_id fe;
        double e;
        int k;
        if (inverted(f_id)) continue;
        fe = get_facet_fe(f_id);
        if (!valid_id(fe)) continue;
        e = (double)get_facet_area(f_id) * (double)get_facet_density(f_id) / 3.0;
        for (k = 0; k < 3; k++) {
            acc[pos_map[ordinal(get_fe_tailv(fe))]] += e;
            fe = get_next_edge(fe);
        }
    }

    n = 0;
    FOR_ALL_VERTICES(v_id) {
        if (n >= max_count) break;
        out[n] = acc[pos_map[ordinal(v_id)]];
        n++;
    }
    free(pos_map); free(acc);
    return n;
}

/* ── se_get_vertex_gaussian_curvatures ────────────────────────────────── */
/* Discrete Gaussian curvature K = (2π − Σ incident face angles) / star_area.
 * Positive at convex peaks, negative at saddles.  SOAPFILM + sdim 3. */
int se_get_vertex_gaussian_curvatures(double *out, int max_count)
{
    vertex_id v_id;
    facet_id  f_id;
    int nv, n, k;
    int *pos_map;
    double *ang, *area;

    if (!se_initialized || !out || max_count <= 0)
        return -1;
    if (web.representation != SOAPFILM || web.sdim != 3)
        return -1;

    nv = (int)web.skel[VERTEX].count;
    if (nv == 0) return 0;

    pos_map = build_vertex_pos_map();
    if (!pos_map) return -1;
    ang  = (double *)calloc((size_t)nv, sizeof(double));
    area = (double *)calloc((size_t)nv, sizeof(double));
    if (!ang || !area) { free(pos_map); free(ang); free(area); return -1; }

    FOR_ALL_FACETS(f_id) {
        facetedge_id fe0, fe1, fe2;
        vertex_id vv[3];
        REAL *p[3];
        double cross_len;
        int pos[3];
        if (inverted(f_id)) continue;
        fe0 = get_facet_fe(f_id);
        if (!valid_id(fe0)) continue;
        fe1 = get_next_edge(fe0);
        fe2 = get_next_edge(fe1);
        vv[0] = get_fe_tailv(fe0);
        vv[1] = get_fe_tailv(fe1);
        vv[2] = get_fe_tailv(fe2);
        for (k = 0; k < 3; k++) { p[k] = get_coord(vv[k]); pos[k] = pos_map[ordinal(vv[k])]; }

        /* triangle area (for the star) and the interior angle at each corner */
        {
            double e01[3], e02[3], cx, cy, cz;
            for (k = 0; k < 3; k++) { e01[k] = (double)(p[1][k]-p[0][k]); e02[k] = (double)(p[2][k]-p[0][k]); }
            cx = e01[1]*e02[2]-e01[2]*e02[1];
            cy = e01[2]*e02[0]-e01[0]*e02[2];
            cz = e01[0]*e02[1]-e01[1]*e02[0];
            cross_len = sqrt(cx*cx+cy*cy+cz*cz);
            if (cross_len < 1e-15) continue;
            area[pos[0]] += cross_len/6.0;
            area[pos[1]] += cross_len/6.0;
            area[pos[2]] += cross_len/6.0;
        }
        for (k = 0; k < 3; k++) {
            int a = (k+1)%3, b = (k+2)%3, m;
            double du = 0, dw = 0, dot = 0, c;
            for (m = 0; m < 3; m++) {
                double uu = (double)(p[a][m]-p[k][m]);
                double ww = (double)(p[b][m]-p[k][m]);
                du += uu*uu; dw += ww*ww; dot += uu*ww;
            }
            if (du < 1e-30 || dw < 1e-30) continue;
            c = dot / sqrt(du*dw);
            if (c >  1.0) c =  1.0;
            if (c < -1.0) c = -1.0;
            ang[pos[k]] += acos(c);
        }
    }

    n = 0;
    FOR_ALL_VERTICES(v_id) {
        int p2 = pos_map[ordinal(v_id)];
        if (n >= max_count) break;
        out[n++] = (area[p2] > 1e-15) ? (2.0*M_PI - ang[p2]) / area[p2] : 0.0;
    }
    free(pos_map); free(ang); free(area);
    return n;
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

/* ── se_get_total_time ────────────────────────────────────────────────── */
/* Accumulated sum of scale factors applied — a proxy for total surface motion. */
double se_get_total_time(void)
{
    return (double)total_time;
}

/* ── physics globals ──────────────────────────────────────────────────── */
/* Read [gravflag, grav_const, pressflag, pressure].  Returns n written, -1 on
 * error. (flags are 0/1 but returned as double for a uniform buffer.) */
int se_get_physics(double *out, int max_count)
{
    double vals[4];
    int i, n;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    vals[0] = (double)web.gravflag;
    vals[1] = (double)web.grav_const;
    vals[2] = (double)web.pressflag;
    vals[3] = (double)web.pressure;
    n = (max_count < 4) ? max_count : 4;
    for (i = 0; i < n; i++)
        out[i] = vals[i];
    return n;
}

/* Write the physics globals.  Mirrors the engine rule that a non-zero
 * gravitational constant implies gravity is on (command.c).  Caller should
 * trigger a recalc afterwards to refresh energy.  Returns 0, or -1 on error. */
int se_set_physics(double grav_const, int gravflag, double pressure, int pressflag)
{
    if (!se_initialized)
        return -1;
    web.grav_const = (REAL)grav_const;
    web.gravflag   = (grav_const != 0.0) ? 1 : gravflag;
    web.pressure   = (REAL)pressure;
    web.pressflag  = pressflag ? 1 : 0;
    return 0;
}

/* Write the mesh-quality thresholds [min_area, min_length, max_len,
 * temperature].  Caller should recalc afterwards.  Returns 0, or -1. */
int se_set_mesh_params(double min_area, double min_length, double max_len, double temperature)
{
    if (!se_initialized)
        return -1;
    web.min_area    = (REAL)min_area;
    web.min_length  = (REAL)min_length;
    web.max_len     = (REAL)max_len;
    web.temperature = (REAL)temperature;
    return 0;
}

/* ── se_get_mesh_params ───────────────────────────────────────────────── */
/* Mesh-quality thresholds, fixed order: [min_area, min_length, max_len,
 * temperature].  Returns number written (<= 4), or -1 on error. */
int se_get_mesh_params(double *out, int max_count)
{
    double vals[4];
    int i, n;
    if (!se_initialized || !out || max_count <= 0)
        return -1;
    vals[0] = (double)web.min_area;
    vals[1] = (double)web.min_length;
    vals[2] = (double)web.max_len;
    vals[3] = (double)web.temperature;
    n = (max_count < 4) ? max_count : 4;
    for (i = 0; i < n; i++)
        out[i] = vals[i];
    return n;
}

/* ── named quantities ─────────────────────────────────────────────────── */
/* Raw count of generalized-quantity slots; iterate 0..count-1 and call
 * se_get_quantity, which returns -1 for deleted/default slots to skip. */
int se_get_quantity_count(void)
{
    return se_initialized ? gen_quant_count : -1;
}

/* Read one quantity by raw slot index.  name/value/target/modulus/flags may be
 * NULL.  Returns 0 on a real quantity, -1 for an empty/deleted/default slot or
 * out-of-range index. */
int se_get_quantity(int idx, char *name, int name_size,
                    double *value, double *target, double *modulus, int *flags)
{
    struct gen_quant *q;
    if (!se_initialized || idx < 0 || idx >= gen_quant_count)
        return -1;
    q = GEN_QUANT(idx);
    if (q->flags & (DEFAULT_QUANTITY | Q_DELETED))
        return -1;
    if (name && name_size > 0) {
        strncpy(name, q->name, (size_t)name_size - 1);
        name[name_size - 1] = '\0';
    }
    if (value)   *value   = (double)q->value;
    if (target)  *target  = (double)q->target;
    if (modulus) *modulus = (double)q->modulus;
    if (flags)   *flags   = q->flags;
    return 0;
}

/* ── method instances (energy breakdown) ──────────────────────────────── */
int se_get_method_instance_count(void)
{
    return se_initialized ? meth_inst_count : -1;
}

/* Read one method instance by raw slot index.  Returns 0 on a real instance,
 * -1 for deleted/default/out-of-range.  `type` is the element type (VERTEX/
 * EDGE/FACET/BODY); `value` is its energy contribution. */
int se_get_method_instance(int idx, char *name, int name_size,
                           int *type, double *value)
{
    struct method_instance *mi;
    if (!se_initialized || idx < 0 || idx >= meth_inst_count)
        return -1;
    mi = METH_INSTANCE(idx);
    if ((mi->flags & (Q_DELETED | DEFAULT_INSTANCE)) || mi->name[0] == '\0')
        return -1;
    if (name && name_size > 0) {
        strncpy(name, mi->name, (size_t)name_size - 1);
        name[name_size - 1] = '\0';
    }
    if (type)  *type  = mi->type;
    if (value) *value = (double)mi->value;
    return 0;
}

/* ── se_get_body_cm ───────────────────────────────────────────────────── */
/*
 * Volume-weighted centre of mass of the body at ordinal `body_idx`.
 *
 * The engine's bptr->cm field is filled only in the graphics pipeline (absent
 * in the headless build), so we compute it directly: decompose the body's
 * bounding surface into tetrahedra (origin, a, b, c) per oriented facet.
 *   signed tet volume  v = a·(b×c)/6
 *   tet centroid          (a+b+c)/4
 *   body centroid = Σ v·centroid / Σ v
 * Each facet bounds get_facet_body(f) on one side and the inverse on the other;
 * contributions are signed so only the net (closed) body volume survives.
 * SOAPFILM + sdim 3 only.  Fills out_xyz[0..2]; returns 3, or -1 on error /
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
        return -1;

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
    if (out_xyz) { REAL *x = get_coord(v_id); for (j = 0; j < sdim; j++) out_xyz[j] = (double)x[j]; }
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

/* ── generic user-defined attributes ──────────────────────────────────── */
/* elem_type: VERTEX=0 EDGE=1 FACET=2 BODY=3. */

/* A readable user attribute: DUMP_ATTR (set only on user-defined, persistent
 * attributes — built-in computed fields like density/__x/force lack it), a
 * plain numeric scalar, not dimensioned/function/internal. This is what
 * distinguishes `define vertex attribute foo real` from the engine's own
 * EXTRAS bookkeeping (which is registered the same way but reads garbage at
 * a naive offset). */
static int is_user_scalar(struct extra *ex)
{
    return (ex->flags & DUMP_ATTR)
        && !(ex->flags & (INTERNAL_ATTR | DIMENSIONED_ATTR | FUNCTION_ATTR))
        && ex->type >= REAL_TYPE && ex->type < MAX_NUMERIC_TYPE
        && ex->array_spec.datacount <= 1;
}

int se_get_attribute_count(int elem_type)
{
    if (!se_initialized || elem_type < 0 || elem_type > BODY)
        return -1;
    return (int)web.skel[elem_type].extra_count;
}

/* Fill name/type for attribute `idx`.  Returns 0 for a readable numeric-scalar
 * attribute, 1 to skip it (internal built-in, array, function, or non-numeric),
 * -1 on error / out-of-range. */
int se_get_attribute_info(int elem_type, int idx, char *name, int name_size, int *type_out)
{
    struct extra *ex;
    if (!se_initialized || elem_type < 0 || elem_type > BODY)
        return -1;
    if (idx < 0 || idx >= (int)web.skel[elem_type].extra_count)
        return -1;
    ex = &EXTRAS(elem_type)[idx];
    if (name && name_size > 0) {
        strncpy(name, ex->name, (size_t)name_size - 1);
        name[name_size - 1] = '\0';
    }
    if (type_out) *type_out = ex->type;
    return is_user_scalar(ex) ? 0 : 1;
}

/* Per-element value of scalar numeric attribute `idx`, cast to double, in the
 * same row order as se_get_vertices/_edges/etc.  Returns count, or -1 if the
 * attribute is not a readable numeric scalar. */
int se_get_attribute_values(int elem_type, int idx, double *out, int max_count)
{
    element_id id;
    struct extra *ex;
    int n = 0, offset, type;

    if (!se_initialized || !out || max_count <= 0 || elem_type < 0 || elem_type > BODY)
        return -1;
    if (idx < 0 || idx >= (int)web.skel[elem_type].extra_count)
        return -1;
    ex = &EXTRAS(elem_type)[idx];
    if (!is_user_scalar(ex))
        return -1;
    offset = ex->offset;
    type   = ex->type;

    FOR_ALL_ELEMENTS(elem_type, id) {
        char *p;
        if (n >= max_count) break;
        p = (char *)elptr(id) + offset;
        switch (type) {
            case REAL_TYPE:    out[n] = (double)*(REAL *)p;            break;
            case INTEGER_TYPE: out[n] = (double)*(int *)p;             break;
            case UINT_TYPE:    out[n] = (double)*(unsigned int *)p;    break;
            case ULONG_TYPE:   out[n] = (double)*(unsigned long *)p;   break;
            case LONG_TYPE:    out[n] = (double)*(long *)p;            break;
            case USHORT_TYPE:  out[n] = (double)*(unsigned short *)p;  break;
            case SHORT_TYPE:   out[n] = (double)*(short *)p;           break;
            case UCHAR_TYPE:   out[n] = (double)*(unsigned char *)p;   break;
            case CHAR_TYPE:    out[n] = (double)*(char *)p;            break;
            default:           out[n] = 0.0;
        }
        n++;
    }
    return n;
}

/* ── output capture helpers ───────────────────────────────────────────── */

int se_pop_output(char *buf, int bufsize)
{
    int n;
    if (!buf || bufsize <= 0)
        return -1;
    fflush(cap_out_fd);
    n = (int)(cap_out_size < (size_t)(bufsize - 1)
              ? cap_out_size : (size_t)(bufsize - 1));
    if (n > 0)
        memcpy(buf, cap_out_buf, n);
    buf[n] = '\0';
    reset_cap(&cap_out_fd, &cap_out_buf, &cap_out_size, &outfd);
    return n;
}

int se_pop_errout(char *buf, int bufsize)
{
    int n;
    if (!buf || bufsize <= 0)
        return -1;
    fflush(cap_err_fd);
    n = (int)(cap_err_size < (size_t)(bufsize - 1)
              ? cap_err_size : (size_t)(bufsize - 1));
    if (n > 0)
        memcpy(buf, cap_err_buf, n);
    buf[n] = '\0';
    reset_cap(&cap_err_fd, &cap_err_buf, &cap_err_size, &erroutfd);
    return n;
}

const char *se_last_error(void)
{
    return se_errmsg_buf;
}
