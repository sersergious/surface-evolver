"""
tests/python/test_se_api.py

Python-layer tests for the Surface Evolver C API accessed via ctypes.
These mirror the C tests in tests/c/test_se_api.c and serve as a
canary for the Python binding layer that will live in bindings/python/.

All tests use the session-scoped `loaded_cube` fixture (cube.fe loaded).
"""

import ctypes
import math

from conftest import _drain


# ── element counts ────────────────────────────────────────────────────────────

def test_vertex_count_positive(loaded_cube):
    assert loaded_cube.se_get_vertex_count() > 0


def test_edge_count_positive(loaded_cube):
    assert loaded_cube.se_get_edge_count() > 0


def test_facet_count_positive(loaded_cube):
    assert loaded_cube.se_get_facet_count() > 0


def test_body_count_nonnegative(loaded_cube):
    assert loaded_cube.se_get_body_count() >= 0


def test_sdim_is_3(loaded_cube):
    assert loaded_cube.se_get_sdim() == 3


# ── scalar state ──────────────────────────────────────────────────────────────

def test_energy_finite(loaded_cube):
    assert math.isfinite(loaded_cube.se_get_energy())


def test_area_positive(loaded_cube):
    area = loaded_cube.se_get_area()
    assert math.isfinite(area) and area > 0.0


def test_scale_positive(loaded_cube):
    scale = loaded_cube.se_get_scale()
    assert math.isfinite(scale) and scale > 0.0


def test_set_scale_roundtrip(loaded_cube):
    original = loaded_cube.se_get_scale()
    loaded_cube.se_set_scale(ctypes.c_double(original * 0.5))
    assert abs(loaded_cube.se_get_scale() - original * 0.5) < 1e-12
    loaded_cube.se_set_scale(ctypes.c_double(original))  # restore


# ── iteration ─────────────────────────────────────────────────────────────────

def test_iterate_energy_nonincreasing(loaded_cube):
    e0 = loaded_cube.se_get_energy()
    loaded_cube.se_iterate(10)
    _drain(loaded_cube)
    e1 = loaded_cube.se_get_energy()
    assert math.isfinite(e1)
    assert e1 >= 0.0
    assert e1 <= e0 + 1e-6, f"Energy increased: {e0} → {e1}"


# ── mesh geometry ─────────────────────────────────────────────────────────────

def test_get_vertices_shape_and_finite(loaded_cube):
    n = loaded_cube.se_get_vertex_count()
    assert n > 0

    buf = (ctypes.c_double * (n * 3))()
    written = loaded_cube.se_get_vertices(buf, n)
    assert written == n

    coords = list(buf)
    assert all(math.isfinite(c) for c in coords), "Non-finite vertex coordinate found"


def test_get_vertex_ids_positive(loaded_cube):
    n = loaded_cube.se_get_vertex_count()
    buf = (ctypes.c_int * n)()
    written = loaded_cube.se_get_vertex_ids(buf, n)
    assert written == n
    assert all(i > 0 for i in buf), "Vertex ID <= 0 found (SE uses 1-based ordinals)"


def test_get_facets_returns_valid(loaded_cube):
    nf = loaded_cube.se_get_facet_count()
    assert nf > 0

    buf = (ctypes.c_int * (nf * 3))()
    written = loaded_cube.se_get_facets(buf, nf)
    # -1 means non-LINEAR representation, which is valid for some models
    assert written >= -1
    if written > 0:
        assert all(i >= 0 for i in buf), "Negative facet vertex index found"


# ── body data ─────────────────────────────────────────────────────────────────

def test_body_volumes_finite(loaded_cube):
    nb = loaded_cube.se_get_body_count()
    if nb == 0:
        return  # no bodies in this model — skip silently

    vols  = (ctypes.c_double * nb)()
    press = (ctypes.c_double * nb)()
    written = loaded_cube.se_get_body_volumes(vols, press, nb)
    assert written == nb
    assert all(math.isfinite(v) for v in vols)
    assert all(math.isfinite(p) for p in press)


# ── output capture ────────────────────────────────────────────────────────────

def test_pop_output_captures_print(loaded_cube):
    loaded_cube.se_run(b'print "hello_pytest"')
    buf = ctypes.create_string_buffer(512)
    n = loaded_cube.se_pop_output(buf, len(buf))
    assert n >= 0
    assert b"hello_pytest" in buf.raw


def test_pop_output_empty_after_drain(loaded_cube):
    _drain(loaded_cube)
    buf = ctypes.create_string_buffer(512)
    n = loaded_cube.se_pop_output(buf, len(buf))
    assert n == 0


def test_invalid_command_produces_error(loaded_cube):
    rc = loaded_cube.se_run(b"not_a_real_command_xyz_abc")
    err_buf = ctypes.create_string_buffer(1024)
    loaded_cube.se_pop_errout(err_buf, len(err_buf))
    # Either the call returns non-zero OR SE emits something on stderr
    assert rc != 0 or len(err_buf.value) > 0
