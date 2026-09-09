//! Integration tests for `worker::Manager` — the Tauri app's own session/
//! worker-lifecycle code (src-tauri/src/worker.rs), which had zero coverage
//! before this (BACKLOG A6). `Manager` takes plain paths, not an AppHandle,
//! so this drives it directly against a real se-worker subprocess, real
//! libse, and real fe/ fixtures — no mocking needed for this layer.

mod common;

use common::{fe, lib_path, scratch_dir, skip, worker_bin};
use serde_json::json;
use surface_evolver::worker::{lock, Manager};

#[test]
fn load_session_returns_real_stats() {
    if skip() { return }
    let mgr = Manager::default();
    let stats = mgr
        .load_session("s1", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load cube.fe");
    assert_eq!(stats["vertex_count"], 14);
    assert_eq!(stats["sdim"], 3);
}

#[test]
fn reload_kills_previous_worker_and_starts_fresh() {
    if skip() { return }
    let mgr = Manager::default();
    mgr.load_session("s1", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load s1");
    let stats2 = mgr
        .load_session("s2", &fe("sphere.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load s2");
    assert!(stats2["vertex_count"].as_u64().unwrap() > 0);

    // s1's worker is gone — a request against it must fail, not silently hit
    // the new worker underneath it.
    let err = mgr.request("s1", json!({ "cmd": "mesh" })).unwrap_err();
    assert!(err.contains("not currently loaded"), "got: {err}");

    // s2 is the live session and still works.
    let mesh = mgr.request("s2", json!({ "cmd": "mesh" })).expect("mesh s2");
    assert_eq!(mesh["ok"], true);
}

#[test]
fn failed_load_leaves_manager_clean_for_the_next_attempt() {
    if skip() { return }
    let dir = scratch_dir("string-fixture");
    let bad = dir.join("string_tri.fe");
    std::fs::write(&bad, concat!(
        "STRING\n",
        "space_dimension 2\n\n",
        "vertices\n1  0.0 0.0\n2  1.0 0.0\n3  0.5 1.0\n\n",
        "edges\n1   1 2\n2   2 3\n3   3 1\n",
    )).unwrap();

    let mgr = Manager::default();
    let err = mgr
        .load_session("bad", &bad.to_string_lossy(), &worker_bin(), &lib_path())
        .unwrap_err();
    assert!(err.to_lowercase().contains("soapfilm"), "got: {err}");

    // Engine state after a failed load is undefined (Landmine 1) — Manager
    // must not register the failed attempt as a live session, and a
    // subsequent good load must work as if nothing happened.
    let after = mgr.request("bad", json!({ "cmd": "mesh" }));
    assert!(after.is_err(), "no session should be registered after a failed load");

    let stats = mgr
        .load_session("good", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load after a failed load must still work");
    assert_eq!(stats["vertex_count"], 14);

    common::cleanup(&dir);
}

#[test]
fn kill_with_no_active_worker_is_a_no_op() {
    let mgr = Manager::default();
    mgr.kill(); // must not panic
    mgr.kill(); // idempotent
}

#[test]
fn request_with_no_worker_loaded_errors_cleanly() {
    let mgr = Manager::default();
    let err = mgr.request("nope", json!({ "cmd": "mesh" })).unwrap_err();
    assert!(err.contains("No active SE worker"), "got: {err}");
}

#[test]
fn worker_dying_mid_session_is_reported_and_recovered_from() {
    if skip() { return }
    let mgr = Manager::default();
    mgr.load_session("s1", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load s1");

    // Simulate a crash out from under the manager (not via kill(), which
    // would clear `io` itself) — proc is `pub` exactly so callers can do
    // this without touching `io`, per the worker.rs Landmine-1 comment.
    {
        let mut proc = lock(&mgr.proc);
        let child = proc.as_mut().expect("worker running");
        child.kill().expect("kill worker process");
        let _ = child.wait();
    }

    let err = mgr.request("s1", json!({ "cmd": "mesh" })).unwrap_err();
    assert!(!err.is_empty());

    // The dead worker's `io` state must have been cleared by the failed
    // request, not left dangling — the next load must succeed cleanly.
    let stats = mgr
        .load_session("s2", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load after a crashed worker must still work");
    assert_eq!(stats["vertex_count"], 14);
}
