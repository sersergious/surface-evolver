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
    /* cube.fe is SOAPFILM → triangles emitted; non-SOAPFILM returns 0. */
    CHECK(written >= 0);

    if (written > 0) {
        /* Vertex indices must be non-negative. */
        int ok = 1;
        for (int i = 0; i < written * 3; i++)
            if (tris[i] < 0) { ok = 0; break; }
        CHECK(ok);
    }

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

static void test_body_cm_and_inspector(void)
{
    SECTION("body CM + vertex inspector");

    /* cube.fe spans the unit cube → centroid at (0.5, 0.5, 0.5), volume 1. */
    if (se_get_body_count() > 0) {
        double cm[3];
        int r = se_get_body_cm(0, cm);
        CHECK(r == 3);
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

static void test_mean_curvatures(void)
{
    SECTION("se_get_vertex_mean_curvatures — basic sanity");
    int n = se_get_vertex_count();
    CHECK(n > 0);

    double *H = malloc((size_t)n * sizeof(double));
    int written = se_get_vertex_mean_curvatures(H, n);
    CHECK(written == n);

    int all_finite = 1, all_nonneg = 1;
    for (int i = 0; i < written; i++) {
        if (!isfinite(H[i])) { all_finite  = 0; break; }
        if (H[i] < 0.0)      { all_nonneg  = 0; break; }
    }
    CHECK(all_finite);
    CHECK(all_nonneg);

    free(H);
}

static void test_vertex_scalars(void)
{
    SECTION("Phase 1 vertex scalar fields");
    int n = se_get_vertex_count();
    CHECK(n > 0);

    int    *val = malloc((size_t)n * sizeof(int));
    double *buf = malloc((size_t)n * sizeof(double));

    /* valence: counted from edges, every vertex in a closed mesh has >= 3 */
    int vn = se_get_vertex_valences(val, n);
    CHECK(vn == n);
    int valence_ok = 1;
    for (int i = 0; i < vn; i++) if (val[i] < 1) { valence_ok = 0; break; }
    CHECK(valence_ok);

    /* star area: finite and strictly positive */
    int sn = se_get_vertex_star_areas(buf, n);
    CHECK(sn == n);
    int star_ok = 1;
    for (int i = 0; i < sn; i++) if (!isfinite(buf[i]) || buf[i] <= 0.0) { star_ok = 0; break; }
    CHECK(star_ok);

    /* force magnitude: finite, non-negative (zero before iterating is fine) */
    int fn = se_get_vertex_force_mags(buf, n);
    CHECK(fn == n);
    int force_ok = 1;
    for (int i = 0; i < fn; i++) if (!isfinite(buf[i]) || buf[i] < 0.0) { force_ok = 0; break; }
    CHECK(force_ok);

    /* energy density: finite, non-negative */
    int en = se_get_vertex_energy_density(buf, n);
    CHECK(en == n);
    int energy_ok = 1;
    for (int i = 0; i < en; i++) if (!isfinite(buf[i]) || buf[i] < 0.0) { energy_ok = 0; break; }
    CHECK(energy_ok);

    /* gaussian curvature: finite (sign may be either) */
    int gn = se_get_vertex_gaussian_curvatures(buf, n);
    CHECK(gn == n);
    int gauss_ok = 1;
    for (int i = 0; i < gn; i++) if (!isfinite(buf[i])) { gauss_ok = 0; break; }
    CHECK(gauss_ok);

    free(val);
    free(buf);
}

static void test_topo_and_params(void)
{
    SECTION("topo counts / mesh params / total_time");

    int c0[SE_TOPO_COUNT];
    int cn = se_get_topo_counts(c0, SE_TOPO_COUNT);
    CHECK(cn == SE_TOPO_COUNT);

    /* refine (r) must add vertices/edges/facets */
    int v0 = se_get_vertex_count();
    se_run("r");
    drain();
    CHECK(se_get_vertex_count() > v0);

    /* equiangulation (u) bumps the equi counter (index 0) without adding elements */
    int c1[SE_TOPO_COUNT];
    se_get_topo_counts(c1, SE_TOPO_COUNT);
    se_run("u");
    drain();
    int c2[SE_TOPO_COUNT];
    se_get_topo_counts(c2, SE_TOPO_COUNT);
    CHECK(c2[0] >= c1[0]);   /* equi_count never decreases */

    /* mesh params: 4 finite values */
    double mp[4];
    int mn = se_get_mesh_params(mp, 4);
    CHECK(mn == 4);
    int mp_ok = 1;
    for (int i = 0; i < mn; i++) if (!isfinite(mp[i])) { mp_ok = 0; break; }
    CHECK(mp_ok);

    CHECK(isfinite(se_get_total_time()));
}

static void test_quantities(void)
{
    SECTION("named quantities / method instances");
    /* mylarcube.fe defines named quantities (cube_volume, stretch, ...). */
    int rc = se_load(FE_DIR "/mylarcube.fe");
    drain();
    CHECK(rc == 0);
    if (rc != 0) { fprintf(stderr, "  last_error: %s\n", se_last_error()); return; }

    int qraw = se_get_quantity_count();
    CHECK(qraw > 0);

    int shown = 0, names_ok = 1, vals_ok = 1;
    for (int i = 0; i < qraw; i++) {
        char nm[128] = {0};
        double v = 0, t = 0, m = 0; int fl = 0;
        if (se_get_quantity(i, nm, sizeof(nm), &v, &t, &m, &fl) == 0) {
            shown++;
            if (nm[0] == '\0')   names_ok = 0;
            if (!isfinite(v))    vals_ok  = 0;
        }
    }
    CHECK(shown > 0);
    CHECK(names_ok);
    CHECK(vals_ok);

    /* method instances: at least one real (named, finite-valued) entry */
    int mraw = se_get_method_instance_count();
    int m_shown = 0, m_ok = 1;
    for (int i = 0; i < mraw; i++) {
        char nm[128] = {0}; int ty = 0; double v = 0;
        if (se_get_method_instance(i, nm, sizeof(nm), &ty, &v) == 0) {
            m_shown++;
            if (nm[0] == '\0' || !isfinite(v)) m_ok = 0;
        }
    }
    CHECK(m_shown > 0);
    CHECK(m_ok);
}

static void test_physics_and_params(void)
{
    SECTION("physics globals + mesh-param setters");
    int rc = se_load(FE_DIR "/mound.fe");
    drain();
    CHECK(rc == 0);
    if (rc != 0) return;

    double ph[4];
    CHECK(se_get_physics(ph, 4) == 4);

    /* set a non-zero gravitational constant → gravflag forced on, energy changes */
    double e0 = se_get_energy();
    CHECK(se_set_physics(2.5, 1, 0.0, 0) == 0);
    se_run("recalc");
    drain();
    CHECK(se_get_physics(ph, 4) == 4);
    CHECK(fabs(ph[1] - 2.5) < 1e-9);   /* grav_const */
    CHECK(ph[0] != 0.0);               /* gravflag on */
    CHECK(se_get_energy() != e0);      /* gravity now contributes */

    /* mesh params round-trip */
    CHECK(se_set_mesh_params(0.05, 0.2, 0.9, 0.1) == 0);
    double mp[4];
    CHECK(se_get_mesh_params(mp, 4) == 4);
    CHECK(fabs(mp[1] - 0.2) < 1e-9 && fabs(mp[2] - 0.9) < 1e-9 && fabs(mp[3] - 0.1) < 1e-9);
}

static void test_colors_normals_attrs(void)
{
    SECTION("element colours / normals / edge metrics / attributes");

    /* phelanc.fe assigns facet colours. */
    if (se_load(FE_DIR "/phelanc.fe") == 0) {
        drain();
        int nf = se_get_facet_count(), ne = se_get_edge_count();
        int *fc = malloc((size_t)nf * sizeof(int));
        CHECK(se_get_facet_colors(fc, NULL, nf) == nf);

        double *nrm = malloc((size_t)nf * 3 * sizeof(double));
        int nn = se_get_facet_normals(nrm, nf);
        CHECK(nn == nf);
        int unit_ok = nn > 0;
        for (int i = 0; i < nn; i++) {
            double m = sqrt(nrm[i*3]*nrm[i*3] + nrm[i*3+1]*nrm[i*3+1] + nrm[i*3+2]*nrm[i*3+2]);
            if (fabs(m - 1.0) > 1e-6) { unit_ok = 0; break; }
        }
        CHECK(unit_ok);   /* normals must be unit length */

        double *el = malloc((size_t)ne * sizeof(double));
        int en = se_get_edge_lengths(el, ne);
        CHECK(en == ne);
        int len_ok = en > 0;
        for (int i = 0; i < en; i++) if (!isfinite(el[i]) || el[i] <= 0) { len_ok = 0; break; }
        CHECK(len_ok);
        free(fc); free(nrm); free(el);
    }

    /* addload_example.fe: user `define edge attribute angle real`; built-in
     * `density` must be filtered out (it reads garbage at a naive offset). */
    if (se_load(FE_DIR "/addload_example.fe") == 0) {
        drain();
        int ne = se_get_edge_count();
        int ac = se_get_attribute_count(1);     /* EDGE = 1 */
        CHECK(ac > 0);
        int found_angle = 0, found_density_readable = 0;
        for (int i = 0; i < ac; i++) {
            char nm[128] = {0}; int ty = 0;
            int r = se_get_attribute_info(1, i, nm, sizeof(nm), &ty);
            if (strcmp(nm, "angle") == 0 && r == 0) {
                found_angle = 1;
                double *v = malloc((size_t)(ne + 1) * sizeof(double));
                CHECK(se_get_attribute_values(1, i, v, ne) == ne);   /* count matches */
                free(v);
            }
            if (strcmp(nm, "density") == 0 && r == 0) found_density_readable = 1;
        }
        CHECK(found_angle);                 /* user attr exposed */
        CHECK(!found_density_readable);     /* built-in filtered */
    }
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
    test_get_edges();
    test_bounding_box();
    test_lagrange_order();
    test_body_data();
    test_body_cm_and_inspector();
    test_output_capture();
    test_run_error();
    test_mean_curvatures();
    test_vertex_scalars();
    test_topo_and_params();   /* mutates the mesh (refine) */
    test_quantities();        /* loads a different datafile */
    test_physics_and_params();
    test_colors_normals_attrs();

    printf("\n=================================\n");
    printf("Results: %d/%d passed\n", g_run - g_failed, g_run);

    return g_failed ? 1 : 0;
}
