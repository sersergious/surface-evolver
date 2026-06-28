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

/* ── se_iterate ───────────────────────────────────────────────────────── */

void se_iterate(int steps)
{
    char buf[64];
    if (!se_initialized || steps <= 0)
        return;
    snprintf(buf, sizeof(buf), "g %d", steps);
    se_run(buf);
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
    if (web.representation != SOAPFILM)
        return -1;

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
