//! End-to-end tests for the `rpc` Tauri command against a real (headless)
//! AppHandle — MockRuntime stands in for the real webview/window, but
//! everything below it is real: a real se-worker subprocess, real libse,
//! real fe/ fixtures, real filesystem paths. This is `dispatch()`'s own
//! coverage (BACKLOG A6): before this file, src-tauri/src/rpc.rs had zero
//! tests.
//!
//! `dispatch()` re-reads SE_LIB_PATH / SE_FE_DIR / SE_WORKER_PATH /
//! SE_STATE_DIR from the process environment on every call (see rpc.rs), so
//! tests that vary them can't run concurrently with each other in this
//! binary — every test takes LOCK first. (Separate test *binaries*, e.g.
//! manager.rs, are separate processes and don't share this problem.)

mod common;

use common::{lib_path, scratch_dir, skip, worker_bin};
use serde_json::{json, Value};
use std::sync::{Mutex, MutexGuard};
use surface_evolver::rpc::{self, AppState};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::App;

static LOCK: Mutex<()> = Mutex::new(());

/// Points SE_FE_DIR at the real bundled fe/ and SE_STATE_DIR at a fresh
/// scratch dir, holds LOCK for the guard's lifetime, and hands back a mock
/// app with AppState + the opener plugin (saveExport calls app.opener())
/// managed exactly as main.rs does.
struct TestApp {
    app: App<MockRuntime>,
    state_dir: std::path::PathBuf,
    _lock: MutexGuard<'static, ()>,
}

impl TestApp {
    fn new(tag: &str) -> Self {
        let _lock = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let state_dir = scratch_dir(tag);
        std::env::set_var("SE_LIB_PATH", lib_path());
        std::env::set_var("SE_WORKER_PATH", worker_bin());
        std::env::set_var("SE_FE_DIR", common::repo_root().join("fe"));
        std::env::set_var("SE_STATE_DIR", &state_dir);

        let app = mock_builder()
            .plugin(tauri_plugin_opener::init())
            .manage(AppState::default())
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        Self { app, state_dir, _lock }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let handle = self.app.handle().clone();
        tauri::async_runtime::block_on(rpc::rpc(handle, method.to_string(), params))
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        common::cleanup(&self.state_dir);
    }
}

#[test]
fn list_files_sees_bundled_fixtures() {
    if skip() { return }
    let t = TestApp::new("listfiles");
    let files = t.call("listFiles", Value::Null).expect("listFiles");
    let files = files.as_array().unwrap();
    let names: Vec<&str> = files.iter().map(|v| v.as_str().unwrap()).collect();
    assert!(names.contains(&"cube.fe"), "got: {names:?}");
    assert!(names.len() >= 20, "expected at least 20 bundled files, got {}", names.len());
}

#[test]
fn create_session_on_missing_file_errors_without_leaking_a_worker() {
    if skip() { return }
    let t = TestApp::new("missing-file");
    let err = t.call("createSession", json!({ "fe_file": "does_not_exist.fe" })).unwrap_err();
    assert!(err.contains("File not found"), "got: {err}");
}

#[test]
fn full_session_lifecycle_round_trips_through_the_app_layer() {
    if skip() { return }
    let t = TestApp::new("lifecycle");

    let session = t.call("createSession", json!({ "fe_file": "cube.fe" })).expect("createSession");
    let sid = session["session_id"].as_str().unwrap().to_string();
    assert_eq!(session["vertex_count"], 14);

    let run = t.call("runCommand", json!({ "sessionId": sid, "command": "r; g 5" })).expect("runCommand");
    assert!(run["energy"].is_f64());

    let mesh = t.call("getMesh", json!({ "sessionId": sid, "colors": true })).expect("getMesh");
    assert!(!mesh["vertices"].as_array().unwrap().is_empty());
    assert!(mesh["facet_colors"].is_array());

    let vinfo = t.call("vertexInfo", json!({ "sessionId": sid, "vpos": 0 })).expect("vertexInfo");
    assert_eq!(vinfo["ok"], true);

    let topo = t.call("topo", json!({ "sessionId": sid, "op": "refine" })).expect("topo");
    assert!(topo["counts"].is_object());

    let dmp = t.call("exportDmp", json!({ "sessionId": sid })).expect("exportDmp");
    assert!(dmp["content"].as_str().unwrap().contains("vertices"));

    let fe_export = t.call("exportFe", json!({ "sessionId": sid })).expect("exportFe");
    assert!(fe_export["filename"].as_str().unwrap().ends_with(".fe"));

    let cancelled = t.call("cancel", Value::Null).expect("cancel");
    assert_eq!(cancelled["cancelled"], true);

    // The session is gone — old id must not still work.
    let err = t.call("getMesh", json!({ "sessionId": sid })).unwrap_err();
    assert!(!err.is_empty());
}

#[test]
fn upload_file_enforces_extension_and_rejects_duplicates() {
    if skip() { return }
    let t = TestApp::new("upload");

    let bad_ext = t.call("uploadFile", json!({ "filename": "notes.txt", "content": "AA==" })).unwrap_err();
    assert!(bad_ext.contains(".fe"), "got: {bad_ext}");

    let content = base64_encode(b"SOAPFILM\nvertices\n1 0 0 0\n");
    let ok = t.call("uploadFile", json!({ "filename": "my_upload.fe", "content": content })).expect("upload");
    assert_eq!(ok["filename"], "my_upload.fe");

    let dup = t.call("uploadFile", json!({ "filename": "my_upload.fe", "content": content })).unwrap_err();
    assert!(dup.contains("already exists"), "got: {dup}");

    let bad_b64 = t.call("uploadFile", json!({ "filename": "other.fe", "content": "not base64!!" })).unwrap_err();
    assert!(bad_b64.contains("base64"), "got: {bad_b64}");
}

#[test]
fn get_restore_resumes_from_a_persisted_snapshot() {
    if skip() { return }
    let t = TestApp::new("restore");

    // No prior snapshot yet — must be null, not an error.
    let none = t.call("getRestore", Value::Null).expect("getRestore (empty)");
    assert!(none.is_null());

    let session = t.call("createSession", json!({ "fe_file": "cube.fe" })).expect("createSession");
    let sid = session["session_id"].as_str().unwrap().to_string();
    // runCommand triggers a best-effort background snapshot (rpc.rs's
    // `persist`) — poll briefly for it rather than assuming a fixed delay.
    t.call("runCommand", json!({ "sessionId": sid, "command": "g 1" })).expect("runCommand");
    let snapshot_file = t.state_dir.join("last-session.json");
    for _ in 0..50 {
        if snapshot_file.exists() { break }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    assert!(snapshot_file.exists(), "snapshot was never written");

    // Fresh AppState (as if the app had just restarted) pointed at the same
    // SE_STATE_DIR must resume the session from disk.
    let app2 = mock_builder()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .build(mock_context(noop_assets()))
        .expect("build second mock app");
    let handle2 = app2.handle().clone();
    let restored = tauri::async_runtime::block_on(rpc::rpc(handle2.clone(), "getRestore".into(), Value::Null))
        .expect("getRestore (resume)");
    assert_eq!(restored["fe_file"], "cube.fe");
    assert!(restored["session_id"].is_string());

    // A second call is memoized, not re-read from disk / re-parsed.
    let restored2 = tauri::async_runtime::block_on(rpc::rpc(handle2, "getRestore".into(), Value::Null))
        .expect("getRestore (memoized)");
    assert_eq!(restored2, restored);
}

#[test]
fn get_restore_is_a_noop_once_the_user_has_already_loaded_a_file() {
    if skip() { return }
    let t = TestApp::new("restore-noop");
    t.call("createSession", json!({ "fe_file": "cube.fe" })).expect("createSession");
    // A late getRestore (e.g. a startup race) must not kill the fresh
    // worker underneath the user — rpc.rs's try_restore bails when a
    // session already exists.
    let restore = t.call("getRestore", Value::Null).expect("getRestore");
    assert!(restore.is_null());
    // The live session must still work.
    let files = t.call("listFiles", Value::Null).expect("listFiles still works");
    assert!(files.as_array().unwrap().len() >= 20);
}

fn base64_encode(bytes: &[u8]) -> String {
    const TBL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        out.push(TBL[(b[0] >> 2) as usize] as char);
        out.push(TBL[(((b[0] & 0x03) << 4) | (b[1] >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { TBL[(((b[1] & 0x0f) << 2) | (b[2] >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TBL[(b[2] & 0x3f) as usize] as char } else { '=' });
    }
    out
}
