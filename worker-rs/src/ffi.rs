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

pub struct Se {
    pub init: unsafe extern "C" fn() -> i32,
    pub load: unsafe extern "C" fn(*const u8) -> i32,
    pub run: unsafe extern "C" fn(*const u8) -> i32,

    pub get_energy: unsafe extern "C" fn() -> f64,
    pub get_area: unsafe extern "C" fn() -> f64,
    pub get_scale: unsafe extern "C" fn() -> f64,
    pub set_scale: unsafe extern "C" fn(f64),
    pub get_total_time: unsafe extern "C" fn() -> f64,

    pub get_sdim: unsafe extern "C" fn() -> i32,
    pub get_vertex_count: unsafe extern "C" fn() -> i32,
    pub get_edge_count: unsafe extern "C" fn() -> i32,
    pub get_facet_count: unsafe extern "C" fn() -> i32,
    pub get_body_count: unsafe extern "C" fn() -> i32,
    pub get_lagrange_order: unsafe extern "C" fn() -> i32,

    pub get_vertices: unsafe extern "C" fn(*mut f64, i32) -> i32,
    pub get_vertex_ids: unsafe extern "C" fn(*mut i32, i32) -> i32,
    pub get_facets: unsafe extern "C" fn(*mut i32, i32) -> i32,
    pub get_edges: unsafe extern "C" fn(*mut i32, i32) -> i32,
    pub get_facet_colors: unsafe extern "C" fn(*mut i32, *mut i32, i32) -> i32,
    pub get_edge_colors: unsafe extern "C" fn(*mut i32, i32) -> i32,
    pub get_bounding_box: unsafe extern "C" fn(*mut f64, *mut f64) -> i32,

    pub get_topo_counts: unsafe extern "C" fn(*mut i32, i32) -> i32,
    pub get_mesh_params: unsafe extern "C" fn(*mut f64, i32) -> i32,
    pub set_mesh_params: unsafe extern "C" fn(f64, f64, f64, f64) -> i32,
    pub get_physics: unsafe extern "C" fn(*mut f64, i32) -> i32,
    pub set_physics: unsafe extern "C" fn(f64, i32, f64, i32) -> i32,

    pub get_body_volumes: unsafe extern "C" fn(*mut f64, *mut f64, i32) -> i32,
    pub get_body_cm: unsafe extern "C" fn(i32, *mut f64) -> i32,

    pub get_quantity_count: unsafe extern "C" fn() -> i32,
    pub get_quantity:
        unsafe extern "C" fn(i32, *mut u8, i32, *mut f64, *mut f64, *mut f64, *mut i32) -> i32,
    pub get_method_instance_count: unsafe extern "C" fn() -> i32,
    pub get_method_instance: unsafe extern "C" fn(i32, *mut u8, i32, *mut i32, *mut f64) -> i32,

    pub get_vertex_info:
        unsafe extern "C" fn(i32, *mut i32, *mut f64, *mut i32, *mut i32, i32) -> i32,
    pub get_constraint_name: unsafe extern "C" fn(i32, *mut u8, i32) -> i32,

    pub pop_output: unsafe extern "C" fn(*mut u8, i32) -> i32,
    pub pop_errout: unsafe extern "C" fn(*mut u8, i32) -> i32,
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
                set_scale: sym(lib, b"se_set_scale\0")?,
                get_total_time: sym(lib, b"se_get_total_time\0")?,

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
                get_bounding_box: sym(lib, b"se_get_bounding_box\0")?,

                get_topo_counts: sym(lib, b"se_get_topo_counts\0")?,
                get_mesh_params: sym(lib, b"se_get_mesh_params\0")?,
                set_mesh_params: sym(lib, b"se_set_mesh_params\0")?,
                get_physics: sym(lib, b"se_get_physics\0")?,
                set_physics: sym(lib, b"se_set_physics\0")?,

                get_body_volumes: sym(lib, b"se_get_body_volumes\0")?,
                get_body_cm: sym(lib, b"se_get_body_cm\0")?,

                get_quantity_count: sym(lib, b"se_get_quantity_count\0")?,
                get_quantity: sym(lib, b"se_get_quantity\0")?,
                get_method_instance_count: sym(lib, b"se_get_method_instance_count\0")?,
                get_method_instance: sym(lib, b"se_get_method_instance\0")?,

                get_vertex_info: sym(lib, b"se_get_vertex_info\0")?,
                get_constraint_name: sym(lib, b"se_get_constraint_name\0")?,

                pop_output: sym(lib, b"se_pop_output\0")?,
                pop_errout: sym(lib, b"se_pop_errout\0")?,
                last_error: sym(lib, b"se_last_error\0")?,
            })
        }
    }
}
