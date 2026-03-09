"""
tests/python/conftest.py

Session-scoped fixtures that load libse.so via ctypes and initialise
the SE runtime once for the whole test run.

Set SE_LIB_PATH to override the default library location.
Set SE_FE_DIR   to override the directory containing .fe datafiles.
"""

import ctypes
import math
import os

import pytest

_DEFAULT_LIB = os.path.join(
    os.path.dirname(__file__), "..", "..", "build", "libse.so"
)
_DEFAULT_FE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "fe"
)

LIB_PATH = os.environ.get("SE_LIB_PATH", _DEFAULT_LIB)
FE_DIR   = os.environ.get("SE_FE_DIR",   _DEFAULT_FE_DIR)


def _configure_argtypes(lib: ctypes.CDLL) -> None:
    """Annotate all se_api.h functions so ctypes can marshal arguments."""

    # lifecycle
    lib.se_init.restype  = ctypes.c_int
    lib.se_init.argtypes = []

    lib.se_load.restype  = ctypes.c_int
    lib.se_load.argtypes = [ctypes.c_char_p]

    # command execution
    lib.se_run.restype  = ctypes.c_int
    lib.se_run.argtypes = [ctypes.c_char_p]

    lib.se_iterate.restype  = None
    lib.se_iterate.argtypes = [ctypes.c_int]

    # scalar state
    lib.se_get_energy.restype  = ctypes.c_double
    lib.se_get_energy.argtypes = []

    lib.se_get_area.restype  = ctypes.c_double
    lib.se_get_area.argtypes = []

    lib.se_get_scale.restype  = ctypes.c_double
    lib.se_get_scale.argtypes = []

    lib.se_set_scale.restype  = None
    lib.se_set_scale.argtypes = [ctypes.c_double]

    lib.se_get_sdim.restype  = ctypes.c_int
    lib.se_get_sdim.argtypes = []

    # element counts
    lib.se_get_vertex_count.restype  = ctypes.c_int
    lib.se_get_vertex_count.argtypes = []

    lib.se_get_edge_count.restype  = ctypes.c_int
    lib.se_get_edge_count.argtypes = []

    lib.se_get_facet_count.restype  = ctypes.c_int
    lib.se_get_facet_count.argtypes = []

    lib.se_get_body_count.restype  = ctypes.c_int
    lib.se_get_body_count.argtypes = []

    # mesh geometry
    lib.se_get_vertices.restype  = ctypes.c_int
    lib.se_get_vertices.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.c_int]

    lib.se_get_vertex_ids.restype  = ctypes.c_int
    lib.se_get_vertex_ids.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]

    lib.se_get_facets.restype  = ctypes.c_int
    lib.se_get_facets.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]

    # body data
    lib.se_get_body_volumes.restype  = ctypes.c_int
    lib.se_get_body_volumes.argtypes = [
        ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_double),
        ctypes.c_int,
    ]

    # output capture
    lib.se_pop_output.restype  = ctypes.c_int
    lib.se_pop_output.argtypes = [ctypes.c_char_p, ctypes.c_int]

    lib.se_pop_errout.restype  = ctypes.c_int
    lib.se_pop_errout.argtypes = [ctypes.c_char_p, ctypes.c_int]

    lib.se_last_error.restype  = ctypes.c_char_p
    lib.se_last_error.argtypes = []


@pytest.fixture(scope="session")
def se_lib() -> ctypes.CDLL:
    """Load libse.so, configure argtypes, and call se_init() once."""
    lib_path = os.path.abspath(LIB_PATH)
    if not os.path.exists(lib_path):
        pytest.skip(f"libse.so not found at {lib_path} — build with -DSE_HEADLESS=ON first")

    lib = ctypes.CDLL(lib_path)
    _configure_argtypes(lib)

    rc = lib.se_init()
    assert rc == 0, f"se_init() failed: {lib.se_last_error()}"
    return lib


@pytest.fixture(scope="session")
def loaded_cube(se_lib: ctypes.CDLL) -> ctypes.CDLL:
    """Load cube.fe once for the whole session."""
    fe_path = os.path.join(os.path.abspath(FE_DIR), "cube.fe").encode()
    rc = se_lib.se_load(fe_path)
    _drain(se_lib)
    assert rc == 0, f"se_load(cube.fe) failed: {se_lib.se_last_error()}"
    return se_lib


def _drain(lib: ctypes.CDLL) -> None:
    """Discard any pending output in SE's capture buffers."""
    buf = ctypes.create_string_buffer(8192)
    lib.se_pop_output(buf, len(buf))
    lib.se_pop_errout(buf, len(buf))
