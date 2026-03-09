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

static void test_set_scale(void)
{
    SECTION("se_set_scale");
    double original = se_get_scale();
    double new_scale = original * 0.5;
    se_set_scale(new_scale);
    double got = se_get_scale();
    CHECK(fabs(got - new_scale) < 1e-12);
    se_set_scale(original); /* restore */
}

static void test_iterate(void)
{
    SECTION("se_iterate");
    double e0 = se_get_energy();
    se_iterate(10);
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
    /*
     * Returns -1 when the surface is not in LINEAR SOAPFILM representation.
     * That's valid — we only CHECK that the return is not a crash/undefined.
     */
    CHECK(written >= -1);

    if (written > 0) {
        /* Vertex indices must be non-negative. */
        int ok = 1;
        for (int i = 0; i < written * 3; i++)
            if (tris[i] < 0) { ok = 0; break; }
        CHECK(ok);
    }

    free(tris);
}

static void test_body_data(void)
{
    SECTION("se_get_body_volumes");
    int nb = se_get_body_count();
    CHECK(nb >= 0);

    if (nb > 0) {
        double *vols  = malloc((size_t)nb * sizeof(double));
        double *press = malloc((size_t)nb * sizeof(double));
        int written = se_get_body_volumes(vols, press, nb);
        CHECK(written == nb);

        int vols_finite = 1, press_finite = 1;
        for (int i = 0; i < written; i++) {
            if (!isfinite(vols[i]))  vols_finite  = 0;
            if (!isfinite(press[i])) press_finite = 0;
        }
        CHECK(vols_finite);
        CHECK(press_finite);

        free(vols);
        free(press);
    }
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

/* ── main ───────────────────────────────────────────────────────────────── */

int main(void)
{
    printf("Surface Evolver C API test suite\n");
    printf("=================================\n");
    printf("FE_DIR = %s\n", FE_DIR);

    test_init();
    test_load();
    test_element_counts();
    test_scalar_state();
    test_set_scale();
    test_iterate();
    test_get_vertices();
    test_get_vertex_ids();
    test_get_facets();
    test_body_data();
    test_output_capture();
    test_run_error();

    printf("\n=================================\n");
    printf("Results: %d/%d passed\n", g_run - g_failed, g_run);

    return g_failed ? 1 : 0;
}
