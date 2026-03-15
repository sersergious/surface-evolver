"""
tests/python/test_se_api.py

Pytest tests for the SurfaceEvolver CFFI wrapper (bindings/python/se.py).

Fixtures are session-scoped (cube.fe loaded once for the whole run).
"""

import math
import os

import pytest

from bindings.python.se import SurfaceEvolver, SEError, _find_library


# ── library path resolution ────────────────────────────────────────────────────

class TestFindLibrary:
    def test_default_path_resolves_to_existing_file(self):
        """_find_library() must return a path that actually exists."""
        path = _find_library()
        assert os.path.isfile(path), f"Library not found at resolved path: {path}"

    def test_env_var_override_is_used(self, monkeypatch, tmp_path):
        """SE_LIB_PATH env var takes precedence over the default build directory."""
        fake = tmp_path / "libse_fake.so"
        fake.touch()
        monkeypatch.setenv("SE_LIB_PATH", str(fake))
        assert _find_library() == str(fake)

    def test_missing_library_raises_file_not_found(self, monkeypatch):
        """_find_library() raises FileNotFoundError when nothing is found."""
        monkeypatch.delenv("SE_LIB_PATH", raising=False)
        # Point the build dir somewhere that definitely has no library.
        import bindings.python.se as se_module
        original = se_module.__file__

        # Temporarily redirect __file__ so _find_library resolves to /tmp.
        monkeypatch.setattr(se_module, "__file__", "/nonexistent/path/se.py")
        with pytest.raises(FileNotFoundError, match="libse not found"):
            se_module._find_library()


# ── SurfaceEvolver constructor ─────────────────────────────────────────────────

class TestConstructor:
    def test_instantiation_succeeds(self):
        """SurfaceEvolver() succeeds when the library is present."""
        se = SurfaceEvolver()
        assert se is not None

    def test_explicit_bad_path_raises(self):
        """Passing a non-existent path raises an appropriate error."""
        with pytest.raises(Exception):
            SurfaceEvolver("/nonexistent/path/libse.so")


# ── element counts ─────────────────────────────────────────────────────────────

class TestElementCounts:
    def test_vertex_count_positive(self, loaded_cube):
        assert loaded_cube.vertex_count() > 0

    def test_edge_count_positive(self, loaded_cube):
        assert loaded_cube.edge_count() > 0

    def test_facet_count_positive(self, loaded_cube):
        assert loaded_cube.facet_count() > 0

    def test_body_count_nonnegative(self, loaded_cube):
        assert loaded_cube.body_count() >= 0


# ── scalar properties ──────────────────────────────────────────────────────────

class TestScalarProperties:
    def test_sdim_is_3(self, loaded_cube):
        assert loaded_cube.sdim == 3

    def test_energy_finite(self, loaded_cube):
        assert math.isfinite(loaded_cube.energy)

    def test_area_positive(self, loaded_cube):
        assert math.isfinite(loaded_cube.area) and loaded_cube.area > 0.0

    def test_scale_positive(self, loaded_cube):
        assert math.isfinite(loaded_cube.scale) and loaded_cube.scale > 0.0

    def test_scale_setter_roundtrip(self, loaded_cube):
        original = loaded_cube.scale
        loaded_cube.scale = original * 0.5
        assert abs(loaded_cube.scale - original * 0.5) < 1e-12
        loaded_cube.scale = original  # restore


# ── iteration ──────────────────────────────────────────────────────────────────

class TestIteration:
    def test_iterate_energy_nonincreasing(self, loaded_cube):
        e0 = loaded_cube.energy
        loaded_cube.iterate(10)
        loaded_cube.pop_output()
        e1 = loaded_cube.energy
        assert math.isfinite(e1)
        assert e1 >= 0.0
        assert e1 <= e0 + 1e-6, f"Energy increased: {e0} → {e1}"


# ── mesh geometry ──────────────────────────────────────────────────────────────

class TestMeshGeometry:
    def test_get_vertices_returns_correct_count(self, loaded_cube):
        n = loaded_cube.vertex_count()
        verts = loaded_cube.get_vertices()
        assert len(verts) == n

    def test_get_vertices_are_3d_tuples(self, loaded_cube):
        verts = loaded_cube.get_vertices()
        assert all(len(v) == 3 for v in verts)

    def test_get_vertices_all_finite(self, loaded_cube):
        verts = loaded_cube.get_vertices()
        assert all(math.isfinite(c) for v in verts for c in v)

    def test_get_vertex_ids_returns_correct_count(self, loaded_cube):
        n = loaded_cube.vertex_count()
        ids = loaded_cube.get_vertex_ids()
        assert len(ids) == n

    def test_get_vertex_ids_are_positive(self, loaded_cube):
        ids = loaded_cube.get_vertex_ids()
        assert all(i > 0 for i in ids), "SE uses 1-based ordinals; all IDs must be > 0"

    def test_get_facets_returns_list(self, loaded_cube):
        facets = loaded_cube.get_facets()
        # Non-linear models return an empty list; linear models return triangles.
        assert isinstance(facets, list)

    def test_get_facets_indices_nonnegative(self, loaded_cube):
        facets = loaded_cube.get_facets()
        if facets:
            assert all(idx >= 0 for tri in facets for idx in tri)

    def test_get_facets_are_triples(self, loaded_cube):
        facets = loaded_cube.get_facets()
        if facets:
            assert all(len(tri) == 3 for tri in facets)


# ── body data ──────────────────────────────────────────────────────────────────

class TestBodyData:
    def test_get_body_volumes_returns_correct_count(self, loaded_cube):
        nb = loaded_cube.body_count()
        bodies = loaded_cube.get_body_volumes()
        assert len(bodies) == nb

    def test_get_body_volumes_finite(self, loaded_cube):
        bodies = loaded_cube.get_body_volumes()
        for b in bodies:
            assert math.isfinite(b["volume"])
            assert math.isfinite(b["pressure"])

    def test_get_body_volumes_have_expected_keys(self, loaded_cube):
        bodies = loaded_cube.get_body_volumes()
        for b in bodies:
            assert "volume" in b and "pressure" in b


# ── command execution & output capture ────────────────────────────────────────

class TestCommandExecution:
    def test_run_print_captured_in_output(self, loaded_cube):
        out = loaded_cube.run('print "hello_pytest"')
        assert "hello_pytest" in out

    def test_pop_output_empty_after_drain(self, loaded_cube):
        loaded_cube.pop_output()
        assert loaded_cube.pop_output() == ""

    def test_pop_errout_returns_string(self, loaded_cube):
        result = loaded_cube.pop_errout()
        assert isinstance(result, str)

    def test_invalid_command_raises_se_error(self, loaded_cube):
        with pytest.raises(SEError):
            loaded_cube.run("not_a_real_command_xyz_abc")

    def test_last_error_returns_string(self, loaded_cube):
        result = loaded_cube.last_error()
        assert isinstance(result, str)
