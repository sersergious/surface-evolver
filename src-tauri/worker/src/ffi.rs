//! Raw FFI binding to libse, loaded at runtime with `libloading`.
//!
//! The library is leaked deliberately: this process owns exactly one libse
//! instance for its whole life (`se_init` cannot run twice — see CLAUDE.md), so
//! there is nothing to unload and leaking lets the resolved function pointers
//! be plain `fn` values instead of lifetime-bound `Symbol`s.
//!
//! Every signature here must match engine/bindings/c/se_api.h exactly. A
//! mismatch is undefined behaviour, not a compile error.

use libloading::{Library, Symbol};

/// The resolved libse symbol table: one field per export of `se_api.h`, in the
/// header's own order.
///
/// Field docs give only the buffer each call writes into, because that is what
/// a Rust caller has to get right and what the compiler cannot check here. The
/// full contract — argument meaning, and which of `-1` / `0` / `>0` a call
/// returns when — lives in `se_api.h` and is deliberately not restated, since a
/// second copy is exactly the drift `tests/ffi_signatures.rs` exists to catch.
///
/// Every `max_count` argument is a capacity, and every return value is the
/// number of rows actually written, which may be smaller. Iterate over the
/// return value clamped to the allocation, never over the return value alone:
/// this crate builds with `panic = "abort"`, so an out-of-bounds index kills
/// the process rather than surfacing as an error.
pub struct Se {
    /// Initialise the runtime. Must succeed before any other call; not
    /// repeatable within a process.
    pub init: unsafe extern "C" fn() -> i32,
    /// Load a `.fe` datafile from a NUL-terminated path. On failure the engine
    /// state is unusable and the process should be discarded.
    pub load: unsafe extern "C" fn(*const u8) -> i32,
    /// Run one NUL-terminated SE command. Blocks with no in-band cancel.
    pub run: unsafe extern "C" fn(*const u8) -> i32,

    /// Total energy of the surface.
    pub get_energy: unsafe extern "C" fn() -> f64,
    /// Total area of the surface.
    pub get_area: unsafe extern "C" fn() -> f64,
    /// Current step-size scale factor.
    pub get_scale: unsafe extern "C" fn() -> f64,

    /// Ambient spatial dimension. Not the coordinate stride — that is always 3.
    pub get_sdim: unsafe extern "C" fn() -> i32,
    /// Vertex count; the row capacity for the vertex, id and info accessors.
    pub get_vertex_count: unsafe extern "C" fn() -> i32,
    /// Edge count; the row capacity for edges, edge colours and edge wraps.
    pub get_edge_count: unsafe extern "C" fn() -> i32,
    /// Facet count; an upper bound on the triangles `get_facets` writes.
    pub get_facet_count: unsafe extern "C" fn() -> i32,
    /// Body count; the row capacity for body volumes and pressures.
    pub get_body_count: unsafe extern "C" fn() -> i32,
    /// Element polynomial order. Greater than 1 means the linear render is
    /// geometrically wrong and the UI should warn.
    pub get_lagrange_order: unsafe extern "C" fn() -> i32,

    /// Vertex coordinates into `[f64; max_count * 3]`. The stride is always 3
    /// regardless of `get_sdim`, zero-padded below it and truncated above it.
    pub get_vertices: unsafe extern "C" fn(*mut f64, i32) -> i32,
    /// 1-based SE ordinals into `[i32; max_count]`, in `get_vertices` order.
    pub get_vertex_ids: unsafe extern "C" fn(*mut i32, i32) -> i32,
    /// Triangle vertex indices into `[i32; max_count * 3]`, 0-based into the
    /// `get_vertices` rows.
    pub get_facets: unsafe extern "C" fn(*mut i32, i32) -> i32,
    /// Edge endpoint indices into `[i32; max_count * 2]`, 0-based into the
    /// `get_vertices` rows.
    pub get_edges: unsafe extern "C" fn(*mut i32, i32) -> i32,
    /// Front and back colour indices into two `[i32; max_count]`, in
    /// `get_facets` row order. Either pointer may be null.
    pub get_facet_colors: unsafe extern "C" fn(*mut i32, *mut i32, i32) -> i32,
    /// Edge colour indices into `[i32; max_count]`, in `get_edges` row order.
    pub get_edge_colors: unsafe extern "C" fn(*mut i32, i32) -> i32,
    /// Per-edge periodic wrap codes into `[i32; max_count]`, in `get_edges` row
    /// order. Returns 0 for a non-periodic surface, which is not an error.
    pub get_edge_wraps: unsafe extern "C" fn(*mut i32, i32) -> i32,
    /// Axis-aligned bounds into two `[f64; sdim]` — sized by `get_sdim`, unlike
    /// the vertex accessors.
    pub get_bounding_box: unsafe extern "C" fn(*mut f64, *mut f64) -> i32,

    /// Cumulative topology counters into `[i32; max_count]`, in the fixed order
    /// mirrored by `TOPO_NAMES` in `handlers.rs`.
    pub get_topo_counts: unsafe extern "C" fn(*mut i32, i32) -> i32,

    /// Volumes and pressures into two `[f64; max_count]`. Either may be null.
    pub get_body_volumes: unsafe extern "C" fn(*mut f64, *mut f64, i32) -> i32,
    /// Centre of mass of one body into `[f64; 3]`. Returns 0 when the surface
    /// is not soapfilm with sdim 3, which is not an error.
    pub get_body_cm: unsafe extern "C" fn(i32, *mut f64) -> i32,

    /// Detail for one vertex: id, `[f64; 3]` coordinates (always 3, as for
    /// `get_vertices`), attribute bits, and up to `cons_max` constraint indices.
    /// Any output pointer may be null. Returns the true constraint count, which
    /// may exceed what fit in the buffer.
    pub get_vertex_info:
        unsafe extern "C" fn(i32, *mut i32, *mut f64, *mut i32, *mut i32, i32) -> i32,
    /// Constraint name into `[u8; size]`, always NUL-terminated, truncated to
    /// fit. Returns 0 on success — it writes no rows.
    pub get_constraint_name: unsafe extern "C" fn(i32, *mut u8, i32) -> i32,

    /// Drain captured stdout into `[u8; bufsize]`. Destructive: whatever does
    /// not fit is discarded rather than held for the next call.
    pub pop_output: unsafe extern "C" fn(*mut u8, i32) -> i32,
    /// Drain captured stderr into `[u8; bufsize]`, same contract.
    pub pop_errout: unsafe extern "C" fn(*mut u8, i32) -> i32,
    /// Borrowed pointer to the last API-level error message. Never null, owned
    /// by the library, invalidated by the next failing call — copy before then.
    pub last_error: unsafe extern "C" fn() -> *const std::os::raw::c_char,
}

/// Resolve one symbol, dereferencing to a plain fn pointer. Safe to detach from
/// the `Library` lifetime only because the library is leaked (never unloaded).
unsafe fn sym<T: Copy>(lib: &'static Library, name: &[u8]) -> Result<T, String> {
    let s: Symbol<T> = lib
        .get(name)
        .map_err(|e| format!("symbol {}: {e}", String::from_utf8_lossy(&name[..name.len() - 1])))?;
    Ok(*s)
}

impl Se {
    /// dlopen + resolve every symbol. Unlike bun:ffi, which throws on the first
    /// missing symbol for the whole table, this reports exactly which one.
    pub fn load_library(path: &str) -> Result<Self, String> {
        unsafe {
            let lib = Library::new(path).map_err(|e| format!("{e}"))?;
            let lib: &'static Library = Box::leak(Box::new(lib));

            Ok(Se {
                init: sym(lib, b"se_init\0")?,
                load: sym(lib, b"se_load\0")?,
                run: sym(lib, b"se_run\0")?,

                get_energy: sym(lib, b"se_get_energy\0")?,
                get_area: sym(lib, b"se_get_area\0")?,
                get_scale: sym(lib, b"se_get_scale\0")?,

                get_sdim: sym(lib, b"se_get_sdim\0")?,
                get_vertex_count: sym(lib, b"se_get_vertex_count\0")?,
                get_edge_count: sym(lib, b"se_get_edge_count\0")?,
                get_facet_count: sym(lib, b"se_get_facet_count\0")?,
                get_body_count: sym(lib, b"se_get_body_count\0")?,
                get_lagrange_order: sym(lib, b"se_get_lagrange_order\0")?,

                get_vertices: sym(lib, b"se_get_vertices\0")?,
                get_vertex_ids: sym(lib, b"se_get_vertex_ids\0")?,
                get_facets: sym(lib, b"se_get_facets\0")?,
                get_edges: sym(lib, b"se_get_edges\0")?,
                get_facet_colors: sym(lib, b"se_get_facet_colors\0")?,
                get_edge_colors: sym(lib, b"se_get_edge_colors\0")?,
                get_edge_wraps: sym(lib, b"se_get_edge_wraps\0")?,
                get_bounding_box: sym(lib, b"se_get_bounding_box\0")?,

                get_topo_counts: sym(lib, b"se_get_topo_counts\0")?,

                get_body_volumes: sym(lib, b"se_get_body_volumes\0")?,
                get_body_cm: sym(lib, b"se_get_body_cm\0")?,

                get_vertex_info: sym(lib, b"se_get_vertex_info\0")?,
                get_constraint_name: sym(lib, b"se_get_constraint_name\0")?,

                pop_output: sym(lib, b"se_pop_output\0")?,
                pop_errout: sym(lib, b"se_pop_errout\0")?,
                last_error: sym(lib, b"se_last_error\0")?,
            })
        }
    }
}
