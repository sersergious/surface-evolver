"""
bindings/python/se.py

High-level Python wrapper for the Surface Evolver C API (libse).
Uses cffi ABI mode — no compilation step required.

Usage:
    from bindings.python.se import SurfaceEvolver, SEError

    se = SurfaceEvolver()          # or SurfaceEvolver("/path/to/libse.so")
    se.load("fe/cube.fe")
    se.iterate(10)
    print(se.energy, se.area)
    verts = se.get_vertices()      # list of (x, y, z) tuples
    faces = se.get_facets()        # list of (v0, v1, v2) index tuples

Set SE_LIB_PATH env var to override the default library search path.
"""

import os

import cffi

# ── FFI setup ──────────────────────────────────────────────────────────────

_ffi = cffi.FFI()

# Declarations copied verbatim from bindings/c/se_api.h (minus preprocessor).
_ffi.cdef("""
    int se_init(void);
    int se_load(const char *filename);

    int  se_run(const char *cmd);
    void se_iterate(int steps);

    double se_get_energy(void);
    double se_get_area(void);
    double se_get_scale(void);
    void   se_set_scale(double s);
    int    se_get_sdim(void);

    int se_get_vertex_count(void);
    int se_get_edge_count(void);
    int se_get_facet_count(void);
    int se_get_body_count(void);

    int se_get_vertices(double *out, int max_count);
    int se_get_vertex_ids(int *ids, int max_count);
    int se_get_facets(int *out, int max_count);

    int se_get_body_volumes(double *volumes, double *pressures, int max_count);

    int         se_pop_output(char *buf, int bufsize);
    int         se_pop_errout(char *buf, int bufsize);
    const char *se_last_error(void);
""")

_OUTPUT_BUFSIZE = 65536

# ── Library discovery ──────────────────────────────────────────────────────

def _find_library() -> str:
    """Return the path to libse, checking SE_LIB_PATH first."""
    env = os.environ.get("SE_LIB_PATH")
    if env:
        return env

    # Resolve relative to this file: bindings/python/ -> ../../build/
    _here = os.path.dirname(os.path.abspath(__file__))
    _build = os.path.join(_here, "..", "..", "build")

    candidates = [
        os.path.join(_build, "libse.dylib"),  # macOS
        os.path.join(_build, "libse.so"),     # Linux
    ]
    for path in candidates:
        if os.path.exists(path):
            return os.path.abspath(path)

    searched = ", ".join(candidates)
    raise FileNotFoundError(
        f"libse not found. Tried: {searched}\n"
        "Build with: cmake -B build -DSE_HEADLESS=ON && cmake --build build\n"
        "Or set SE_LIB_PATH to the library path."
    )


# ── Public exception ───────────────────────────────────────────────────────

class SEError(RuntimeError):
    """Raised when a Surface Evolver API call returns an error."""


# ── Main wrapper class ─────────────────────────────────────────────────────

class SurfaceEvolver:
    """Pythonic wrapper around libse (Surface Evolver shared library)."""

    def __init__(self, lib_path: str | None = None) -> None:
        path = lib_path or _find_library()
        self._lib = _ffi.dlopen(path)
        rc = self._lib.se_init()
        if rc != 0:
            raise SEError(f"se_init() failed: {self.last_error()}")

    # ── output helpers ─────────────────────────────────────────────────────

    def _drain_output(self) -> str:
        buf = _ffi.new("char[]", _OUTPUT_BUFSIZE)
        self._lib.se_pop_output(buf, _OUTPUT_BUFSIZE)
        return _ffi.string(buf).decode(errors="replace")

    def _drain_errout(self) -> str:
        buf = _ffi.new("char[]", _OUTPUT_BUFSIZE)
        self._lib.se_pop_errout(buf, _OUTPUT_BUFSIZE)
        return _ffi.string(buf).decode(errors="replace")

    # ── lifecycle ──────────────────────────────────────────────────────────

    def load(self, path: str) -> None:
        """Load a Surface Evolver datafile (.fe)."""
        rc = self._lib.se_load(path.encode())
        self._drain_output()
        self._drain_errout()
        if rc != 0:
            raise SEError(f"se_load({path!r}) failed: {self.last_error()}")

    # ── command execution ──────────────────────────────────────────────────

    def run(self, cmd: str) -> str:
        """Execute an SE language command. Returns captured stdout."""
        rc = self._lib.se_run(cmd.encode())
        out = self._drain_output()
        self._drain_errout()
        if rc != 0:
            raise SEError(f"se_run({cmd!r}) failed: {self.last_error()}")
        return out

    def iterate(self, steps: int) -> None:
        """Run `steps` gradient-descent iterations."""
        self._lib.se_iterate(steps)

    # ── scalar state ───────────────────────────────────────────────────────

    @property
    def energy(self) -> float:
        return self._lib.se_get_energy()

    @property
    def area(self) -> float:
        return self._lib.se_get_area()

    @property
    def scale(self) -> float:
        return self._lib.se_get_scale()

    @scale.setter
    def scale(self, value: float) -> None:
        self._lib.se_set_scale(value)

    @property
    def sdim(self) -> int:
        return self._lib.se_get_sdim()

    # ── element counts ─────────────────────────────────────────────────────

    def vertex_count(self) -> int:
        return self._lib.se_get_vertex_count()

    def edge_count(self) -> int:
        return self._lib.se_get_edge_count()

    def facet_count(self) -> int:
        return self._lib.se_get_facet_count()

    def body_count(self) -> int:
        return self._lib.se_get_body_count()

    # ── mesh geometry ──────────────────────────────────────────────────────

    def get_vertices(self) -> list[tuple[float, ...]]:
        """Return vertex coordinates as a list of (x, y, z) tuples."""
        n = self.vertex_count()
        if n == 0:
            return []
        dim = self.sdim
        buf = _ffi.new("double[]", n * dim)
        written = self._lib.se_get_vertices(buf, n)
        if written < 0:
            raise SEError(f"se_get_vertices() failed: {self.last_error()}")
        return [
            tuple(buf[i * dim + d] for d in range(dim))
            for i in range(written)
        ]

    def get_vertex_ids(self) -> list[int]:
        """Return the 1-based SE ordinal for each vertex (same order as get_vertices)."""
        n = self.vertex_count()
        if n == 0:
            return []
        buf = _ffi.new("int[]", n)
        written = self._lib.se_get_vertex_ids(buf, n)
        if written < 0:
            raise SEError(f"se_get_vertex_ids() failed: {self.last_error()}")
        return list(buf[0:written])

    def get_facets(self) -> list[tuple[int, int, int]]:
        """Return triangle connectivity as a list of (v0, v1, v2) index tuples (0-based).
        Returns [] for non-SOAPFILM representations (STRING, simplex, etc.)."""
        n = self.facet_count()
        if n == 0:
            return []
        buf = _ffi.new("int[]", n * 3)
        written = self._lib.se_get_facets(buf, n)
        if written < 0:
            # non-SOAPFILM representation (STRING, simplex, etc.) — no triangles
            return []
        return [
            (buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2])
            for i in range(written)
        ]

    # ── body data ──────────────────────────────────────────────────────────

    def get_body_volumes(self) -> list[dict[str, float]]:
        """Return [{"volume": …, "pressure": …}, …] for each body."""
        n = self.body_count()
        if n == 0:
            return []
        vols = _ffi.new("double[]", n)
        pres = _ffi.new("double[]", n)
        written = self._lib.se_get_body_volumes(vols, pres, n)
        if written < 0:
            raise SEError(f"se_get_body_volumes() failed: {self.last_error()}")
        return [
            {"volume": vols[i], "pressure": pres[i]}
            for i in range(written)
        ]

    # ── output capture ─────────────────────────────────────────────────────

    def pop_output(self) -> str:
        """Return and clear SE's captured stdout."""
        return self._drain_output()

    def pop_errout(self) -> str:
        """Return and clear SE's captured stderr."""
        return self._drain_errout()

    def last_error(self) -> str:
        """Return the last API-level error string."""
        raw = self._lib.se_last_error()
        return _ffi.string(raw).decode(errors="replace") if raw != _ffi.NULL else ""
