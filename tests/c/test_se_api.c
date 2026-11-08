/*
 * tests/c/test_se_api.c
 *
 * Integration tests for the Surface Evolver C API (se_api.h).
 * Runs against libse.so (headless build).
 *
 * No external test framework — CTest reports pass/fail via exit code.
 * Build: configured by tests/CMakeLists.txt, linked against the `se` target.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "se_api.h"

#ifdef _WIN32
#  include <direct.h>
#  define getcwd _getcwd
#  include <windows.h>
#else
#  include <unistd.h>
#endif

#if defined(_WIN64)
/* Windows-only crash report. The suite crashed natively on Windows but passed
 * under gdb, so the debugger was changing the behaviour. This prints the
 * exception and the faulting stack as module+offset lines, which CI resolves
 * with addr2line against the RelWithDebInfo symbols. Remove once Windows is
 * green. */
static void print_frame(DWORD64 pc)
{
    HMODULE mod = NULL;
    char name[MAX_PATH] = "?";
    GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                       GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       (LPCSTR)(ULONG_PTR)pc, &mod);
    if (mod) GetModuleFileNameA(mod, name, sizeof(name));
    fprintf(stderr, "  frame %s+0x%llx\n", name,
            (unsigned long long)(pc - (DWORD64)(ULONG_PTR)mod));
}

/* Vectored, not SetUnhandledExceptionFilter: an unhandled filter never ran,
 * which points at a fault raised while longjmp unwinds the stack. A vectored
 * handler sees every exception first; report only fatal codes, once. */
static LONG WINAPI report_crash(EXCEPTION_POINTERS *ep)
{
    static volatile LONG reported = 0;
    DWORD code = ep->ExceptionRecord->ExceptionCode;
    if (code != EXCEPTION_ACCESS_VIOLATION && code != EXCEPTION_STACK_OVERFLOW &&
        code != 0xC0000409 /* fast fail */ && code != 0xC0000028 /* bad stack */ &&
        code != 0xC0000026 /* invalid disposition */ && code != 0xC0000417 /* CRT invalid parameter */)
        return EXCEPTION_CONTINUE_SEARCH;
    if (InterlockedExchange(&reported, 1))
        return EXCEPTION_CONTINUE_SEARCH;
    CONTEXT ctx = *ep->ContextRecord;
    fprintf(stderr, "\nCRASH code=0x%08lx flags=0x%lx\n", code, ep->ExceptionRecord->ExceptionFlags);
    for (int i = 0; i < 16 && ctx.Rip; i++) {
        DWORD64 base = 0;
        print_frame(ctx.Rip);
        PRUNTIME_FUNCTION fn = RtlLookupFunctionEntry(ctx.Rip, &base, NULL);
        if (!fn) {                       /* leaf function: return address on top */
            ctx.Rip = *(DWORD64 *)(ULONG_PTR)ctx.Rsp;
            ctx.Rsp += 8;
            continue;
        }
        void *handler_data; DWORD64 frame;
        RtlVirtualUnwind(UNW_FLAG_NHANDLER, base, ctx.Rip, fn, &ctx,
                         &handler_data, &frame, NULL);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
#endif

/* ── Minimal harness ────────────────────────────────────────────────────── */

static int g_run    = 0;
static int g_failed = 0;

#define CHECK(expr) do {                                                        \
    g_run++;                                                                    \
    if (!(expr)) {                                                              \
        g_failed++;                                                             \
        fprintf(stderr, "  FAIL  %s  (%s:%d)\n", #expr, __FILE__, __LINE__);   \
    } else {                                                                    \
        printf("  pass  %s\n", #expr);                                         \
    }                                                                           \
} while (0)

#define SECTION(name)  printf("\n[%s]\n", name)

/* ── Helpers ────────────────────────────────────────────────────────────── */

#ifndef FE_DIR
#  define FE_DIR "fe"
#endif
#define FE_CUBE FE_DIR "/cube.fe"

static void drain(void)
{
    char buf[8192];
    se_pop_output(buf, sizeof(buf));
    se_pop_errout(buf, sizeof(buf));
}

/* ── Test groups ────────────────────────────────────────────────────────── */

static void test_init(void)
{
    SECTION("se_init");
    int rc = se_init();
    CHECK(rc == 0);
    if (rc != 0) {
        fprintf(stderr, "  last_error: %s\n", se_last_error());
        /* Cannot continue without a working runtime. */
        fprintf(stderr, "\nFATAL: se_init failed — aborting.\n");
        exit(1);
    }
}

static void test_load(void)
{
    SECTION("se_load(" FE_CUBE ")");
    int rc = se_load(FE_CUBE);
    drain();
    CHECK(rc == 0);
    if (rc != 0)
        fprintf(stderr, "  last_error: %s\n", se_last_error());
}

static void test_element_counts(void)
{
    SECTION("element counts");
    CHECK(se_get_vertex_count() > 0);
    CHECK(se_get_edge_count()   > 0);
    CHECK(se_get_facet_count()  > 0);
    CHECK(se_get_body_count()   >= 0);
    CHECK(se_get_sdim()         == 3);
}

static void test_scalar_state(void)
{
    SECTION("scalar state");
    double energy = se_get_energy();
    double area   = se_get_area();
    double scale  = se_get_scale();

    CHECK(isfinite(energy));
    CHECK(isfinite(area));
    CHECK(area > 0.0);
    CHECK(isfinite(scale));
    CHECK(scale > 0.0);
}

static void test_iterate(void)
{
    SECTION("iterate (g 10)");
    double e0 = se_get_energy();
    se_run("g 10");
    drain();
    double e1 = se_get_energy();

    CHECK(isfinite(e1));
    CHECK(e1 >= 0.0);
    /* Gradient descent must not increase energy (allow tiny float noise). */
    CHECK(e1 <= e0 + 1e-6);
}

static void test_get_vertices(void)
{
    SECTION("se_get_vertices");
    int n = se_get_vertex_count();
    CHECK(n > 0);

    double *coords = malloc((size_t)n * 3 * sizeof(double));
    int written = se_get_vertices(coords, n);
    CHECK(written == n);

    /* All coordinates must be finite. */
    int all_finite = 1;
    for (int i = 0; i < written * 3; i++)
        if (!isfinite(coords[i])) { all_finite = 0; break; }
    CHECK(all_finite);

    free(coords);
}

static void test_get_vertex_ids(void)
{
    SECTION("se_get_vertex_ids");
    int n = se_get_vertex_count();
    int *ids = malloc((size_t)n * sizeof(int));
    int written = se_get_vertex_ids(ids, n);
    CHECK(written == n);

    /* IDs must all be positive (SE uses 1-based ordinals). */
    int all_positive = 1;
    for (int i = 0; i < written; i++)
        if (ids[i] <= 0) { all_positive = 0; break; }
    CHECK(all_positive);

    free(ids);
}

static void test_get_facets(void)
{
    SECTION("se_get_facets");
    int nf = se_get_facet_count();
    CHECK(nf > 0);

    int *tris = malloc((size_t)nf * 3 * sizeof(int));
    int written = se_get_facets(tris, nf);
    /* cube.fe is SOAPFILM, so every facet is emitted as a triangle. An exact
     * count, not >= 0: a zero would otherwise skip the index check below. */
    CHECK(written == nf);

    /* Indices are positions into the se_get_vertices() buffer. */
    int nv = se_get_vertex_count();
    int ok = written > 0;
    for (int i = 0; i < written * 3; i++)
        if (tris[i] < 0 || tris[i] >= nv) { ok = 0; break; }
    CHECK(ok);

    free(tris);
}

static void test_get_edges(void)
{
    SECTION("se_get_edges");
    int ne = se_get_edge_count();
    int nv = se_get_vertex_count();
    CHECK(ne > 0);

    int *edges = malloc((size_t)ne * 2 * sizeof(int));
    int written = se_get_edges(edges, ne);
    CHECK(written == ne);

    /* Endpoints must be valid 0-based vertex positions and not self-loops. */
    int ok = 1;
    for (int i = 0; i < written; i++) {
        int t = edges[i * 2], h = edges[i * 2 + 1];
        if (t < 0 || t >= nv || h < 0 || h >= nv || t == h) { ok = 0; break; }
    }
    CHECK(ok);

    free(edges);
}

static void test_bounding_box(void)
{
    SECTION("se_get_bounding_box");
    int sdim = se_get_sdim();
    double mn[8], mx[8];
    int rc = se_get_bounding_box(mn, mx);
    CHECK(rc == sdim);

    int ok = 1;
    for (int i = 0; i < sdim; i++)
        if (!isfinite(mn[i]) || !isfinite(mx[i]) || mn[i] > mx[i]) { ok = 0; break; }
    CHECK(ok);
}

static void test_lagrange_order(void)
{
    SECTION("se_get_lagrange_order");
    /* cube.fe is a linear model → order 1. */
    CHECK(se_get_lagrange_order() == 1);
}

static void test_body_data(void)
{
    SECTION("se_get_body_volumes");
    /* cube.fe has exactly one body, held at volume 1 by its constraint even
     * after the earlier `g 10`. Exact, so a missing body fails instead of
     * skipping the checks below. */
    int nb = se_get_body_count();
    CHECK(nb == 1);

    double vols[1] = {0}, press[1] = {0};
    CHECK(se_get_body_volumes(vols, press, 1) == 1);
    CHECK(fabs(vols[0] - 1.0) < 1e-6);
    CHECK(isfinite(press[0]));
}

static void test_body_cm_and_inspector(void)
{
    SECTION("body CM + vertex inspector");

    /* cube.fe spans the unit cube → centroid at (0.5, 0.5, 0.5); evolving
     * it symmetrically keeps it there. */
    {
        double cm[3] = {0};
        CHECK(se_get_body_cm(0, cm) == 3);
        CHECK(fabs(cm[0] - 0.5) < 1e-9);
        CHECK(fabs(cm[1] - 0.5) < 1e-9);
        CHECK(fabs(cm[2] - 0.5) < 1e-9);
    }
    /* out-of-range body index → -1 */
    { double cm[3]; CHECK(se_get_body_cm(9999, cm) == -1); }

    /* vertex inspector: first vertex resolves to a positive id + finite coords */
    {
        int id = 0, attr = 0, cons[8];
        double xyz[3];
        int nc = se_get_vertex_info(0, &id, xyz, &attr, cons, 8);
        CHECK(nc >= 0);
        CHECK(id > 0);
        CHECK(isfinite(xyz[0]) && isfinite(xyz[1]) && isfinite(xyz[2]));
    }
    /* out-of-range vertex position → -1 */
    CHECK(se_get_vertex_info(999999, NULL, NULL, NULL, NULL, 0) == -1);
}

static void test_output_capture(void)
{
    SECTION("output capture");
    /* Run a command that produces output. */
    int rc = se_run("print \"hello_test\"");
    CHECK(rc == 0);

    char buf[512] = {0};
    int n = se_pop_output(buf, sizeof(buf));
    CHECK(n >= 0);
    /* SE print adds a newline; "hello_test" must appear somewhere. */
    CHECK(strstr(buf, "hello_test") != NULL);

    /* Second pop returns empty. */
    char buf2[512] = {0};
    int n2 = se_pop_output(buf2, sizeof(buf2));
    CHECK(n2 == 0);
}

static void test_run_error(void)
{
    SECTION("se_run (invalid command)");
    int rc = se_run("this_is_not_a_valid_se_command_xyz");
    /* SE should report a non-zero return or populate errout. */
    char err[1024] = {0};
    se_pop_errout(err, sizeof(err));
    /* Either the return code is non-zero OR an error message was emitted. */
    CHECK(rc != 0 || strlen(err) > 0);
}

/* #30: input with nothing to execute is not a failure, and a success clears
 * the previous failure's message instead of leaving it for the next caller. */
static void test_run_noop_and_error_state(void)
{
    SECTION("se_run (comment-only input, error state)");
    CHECK(se_run("// just a note") == 0);
    CHECK(se_run("   ") == 0);
    drain();

    CHECK(se_run("this_is_not_a_valid_se_command_xyz") != 0);
    CHECK(se_last_error()[0] != '\0');
    drain();
    CHECK(se_run("print 1") == 0);
    drain();
    CHECK(se_last_error()[0] == '\0');
}

/* A RECOVERABLE engine error raised inside se_run (here 1212, an illegal
 * constraint number) goes through kb_error's bailout and lands in se_run's
 * own jumpbuf handler, not command()'s: the engine's text must come back and
 * capture must keep working afterwards. */
static void test_run_recoverable_error(void)
{
    SECTION("se_run (RECOVERABLE error)");
    CHECK(se_run("set vertex[1] constraint 99") != 0);
    CHECK(strstr(se_last_error(), "1212") != NULL);
    CHECK(se_run("print 5150") == 0);
    char buf[256] = {0};
    se_pop_output(buf, sizeof(buf));
    CHECK(strstr(buf, "5150") != NULL);
}

/* #20: SE's `load` longjmps to a buffer only the standalone main() sets.
 * It must fail like any other command, leaving the surface alone. */
static void test_run_load_is_refused(void)
{
    SECTION("se_run (load command)");
    int v0 = se_get_vertex_count();
    CHECK(se_run("load \"" FE_CUBE "\"") != 0);
    CHECK(strstr(se_last_error(), "File") != NULL);
    drain();
    CHECK(se_get_vertex_count() == v0);
    CHECK(se_run("print 1") == 0);   /* engine still usable */
    drain();
}

/* #19: a datafile error ends in the engine's bailout, which fclose()s both
 * capture streams. se_load used to return with them closed, so afterwards SE
 * printed to the real stdout (the worker's IPC pipe) and the parse error was
 * replaced by a generic message. */
static void test_failed_load_keeps_capture(void)
{
    SECTION("se_load (datafile error keeps output capture)");
    /* Absolute, like every path the app passes: the engine's path_open reads
     * one byte before the name for a relative path (utility.c), which ASan
     * flags. */
    char bad[1024];
    if (!getcwd(bad, sizeof(bad) - 32)) strcpy(bad, ".");
    strcat(bad, "/se_test_broken.fe");
    FILE *f = fopen(bad, "w");
    fputs("vertices\n1 0 0 0\n2 1 0 0\n3 0 1 0\n"
          "edges\n1 1 2\n2 2 3\n3 3 1\n"
          "faces\n1 1 2 99\n", f);          /* edge 99 does not exist */
    fclose(f);

    CHECK(se_load(bad) != 0);
    CHECK(strncmp(se_last_error(), "Error loading", 13) != 0);  /* the real error */
    remove(bad);

    /* The issue's repro: straight after the failed load, output must still be
     * captured rather than leak to the real stdout. No drain() first: popping
     * used to fclose the already-closed stream and reopen it, hiding the bug
     * behind a double fclose. */
    CHECK(se_run("print 4242") == 0);
    char buf[256] = {0};
    se_pop_output(buf, sizeof(buf));
    CHECK(strstr(buf, "4242") != NULL);

    CHECK(se_load(FE_CUBE) == 0);   /* the tests after this need a surface */
    drain();
}

static void test_topo_and_params(void)
{
    SECTION("topo counts");

    int c0[SE_TOPO_COUNT];
    int cn = se_get_topo_counts(c0, SE_TOPO_COUNT);
    CHECK(cn == SE_TOPO_COUNT);

    /* refine (r) must add vertices/edges/facets */
    int v0 = se_get_vertex_count();
    se_run("r");
    drain();
    CHECK(se_get_vertex_count() > v0);

    /* equiangulation (u) swaps edges, never adds or removes elements. (The
     * old check here, "equi_count never decreases", could not fail.) */
    int v1 = se_get_vertex_count(), e1 = se_get_edge_count(), f1 = se_get_facet_count();
    CHECK(se_run("u") == 0);
    drain();
    CHECK(se_get_vertex_count() == v1);
    CHECK(se_get_edge_count() == e1);
    CHECK(se_get_facet_count() == f1);
}

static void test_element_colors(void)
{
    SECTION("element colours");

    /* phelanc.fe assigns facet colours. The load is a CHECK itself: inside
     * an `if`, a failed load used to make the checks vanish silently. */
    int loaded = se_load(FE_DIR "/phelanc.fe") == 0;
    drain();
    CHECK(loaded);
    if (loaded) {
        int nf = se_get_facet_count();
        int *fc = malloc((size_t)nf * sizeof(int));
        CHECK(se_get_facet_colors(fc, NULL, nf) == nf);
        free(fc);
    }
}

static void test_edge_wraps(void)
{
    SECTION("se_get_edge_wraps");

    /* cube.fe is not periodic → 0, and specifically not -1: "not applicable"
     * is not an error. Must be safe even though E_WRAP_ATTR has no storage. */
    int loaded = se_load(FE_CUBE) == 0;
    drain();
    CHECK(loaded);
    if (loaded) {
        int ne = se_get_edge_count();
        int *w = malloc((size_t)ne * sizeof(int));
        CHECK(se_get_edge_wraps(w, ne) == 0);
        free(w);
    }

    /* phelanc.fe is TORUS_FILLED. foam audit item F1 measured 103 of 368 edges as
     * wrap-around; assert we see wraps, and that they are a strict minority. */
    loaded = se_load(FE_DIR "/phelanc.fe") == 0;
    drain();
    CHECK(loaded);
    if (loaded) {
        int ne = se_get_edge_count();
        int *w = malloc((size_t)ne * sizeof(int));
        int n = se_get_edge_wraps(w, ne);
        CHECK(n == ne);

        int wrapped = 0;
        for (int i = 0; i < n; i++) if (w[i] != 0) wrapped++;
        printf("      phelanc.fe: %d of %d edges wrapped\n", wrapped, n);
        CHECK(wrapped > 0);
        CHECK(wrapped < n);
        free(w);
    }

    /* bad args stay -1 */
    CHECK(se_get_edge_wraps(NULL, 10) == -1);
}

/* ── main ───────────────────────────────────────────────────────────────── */

int main(void)
{
    /* Unbuffered, so a crash still leaves the last section and checks in
     * the log; buffered output used to vanish with the process. */
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
#if defined(_WIN64)
    AddVectoredExceptionHandler(1, report_crash);
#endif

    printf("Surface Evolver C API test suite\n");
    printf("=================================\n");
    printf("FE_DIR = %s\n", FE_DIR);

    test_init();
    test_load();
    test_element_counts();
    test_scalar_state();
    test_iterate();
    test_get_vertices();
    test_get_vertex_ids();
    test_get_facets();
    test_get_edges();
    test_bounding_box();
    test_lagrange_order();
    test_body_data();
    test_body_cm_and_inspector();
    test_output_capture();
    test_run_error();
    test_run_noop_and_error_state();
    test_run_recoverable_error();      /* se_run's own jumpbuf handler */
    test_failed_load_keeps_capture();  /* se_load's jumpbuf handler (#19) */
    test_run_load_is_refused();        /* loadjumpbuf (#20) */
    test_topo_and_params();   /* mutates the mesh (refine) */
    test_element_colors();
    test_edge_wraps();

    printf("\n=================================\n");
    printf("Results: %d/%d passed\n", g_run - g_failed, g_run);

    return g_failed ? 1 : 0;
}
