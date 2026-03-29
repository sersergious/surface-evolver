"""
tests/python/conftest.py

Session-scoped fixtures for the SurfaceEvolver CFFI wrapper tests.

Set SE_LIB_PATH to override the default library location.
Set SE_FE_DIR   to override the directory containing .fe datafiles.
"""

import os
import sys

# Allow `from app.xxx import ...` to resolve against backend/
_BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "backend")
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, os.path.abspath(_BACKEND_DIR))

import pytest

from bindings.python.se import SurfaceEvolver

_DEFAULT_FE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "fe"
)

FE_DIR = os.environ.get("SE_FE_DIR", _DEFAULT_FE_DIR)


@pytest.fixture(scope="session")
def se() -> SurfaceEvolver:
    """Construct a SurfaceEvolver instance (library loaded, se_init called)."""
    try:
        return SurfaceEvolver()
    except FileNotFoundError as exc:
        pytest.skip(str(exc))


@pytest.fixture(scope="session")
def loaded_cube(se: SurfaceEvolver) -> SurfaceEvolver:
    """Load cube.fe once for the whole session."""
    fe_path = os.path.join(os.path.abspath(FE_DIR), "cube.fe")
    se.load(fe_path)
    return se
