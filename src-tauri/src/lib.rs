//! Library target, split out of main.rs so integration tests (src-tauri/tests/)
//! can link against `rpc`/`worker` — a bin-only crate has no target for `tests/`
//! to depend on. `rpc` is generic over `R: Runtime` (matches Tauri's own
//! built-in commands, e.g. `tauri::app::name<R: Runtime>`) precisely so tests
//! can drive it with `tauri::test::MockRuntime` instead of the real `Wry`.

pub mod menu;
pub mod rpc;
pub mod worker;
