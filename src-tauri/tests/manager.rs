//! Integration tests for `worker::Manager` — the Tauri app's own session/
//! worker-lifecycle code (src-tauri/src/worker.rs), which had zero coverage
//! before this (audit item A6). `Manager` takes plain paths, not an AppHandle,
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

#[test]
fn kill_unblocks_an_in_flight_request() {
    if skip() { return }
    // The reason for the io/proc mutex split: Stop must not wait for the
    // running command. kill() takes only `proc`, so the blocked reader gets
    // EOF and the request returns an error instead of running to completion.
    // Detached threads + a channel timeout: if kill() regresses to waiting on
    // `io`, this fails in 10 s instead of hanging the whole test run.
    let mgr = std::sync::Arc::new(Manager::default());
    mgr.load_session("s1", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load cube.fe");
    let (tx, rx) = std::sync::mpsc::channel();
    let m = mgr.clone();
    std::thread::spawn(move || {
        let _ = tx.send(m.request("s1", json!({ "cmd": "run", "command": "r; r; r; r; r; r; g 100000" })));
    });
    std::thread::sleep(std::time::Duration::from_millis(500));
    let m = mgr.clone();
    std::thread::spawn(move || m.kill());
    let res = rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("kill did not unblock the in-flight request");
    let err = res.expect_err("a killed command must not report success");
    assert!(err.contains("crashed"), "got: {err}");
    assert!(mgr.request("s1", json!({ "cmd": "mesh" })).is_err(), "no session survives a kill");
}

#[test]
fn interrupt_stops_a_running_command_and_keeps_the_session() {
    if skip() { return }
    // #35: SIGINT makes SE abort the command (ERROR 2073) and keep both the
    // worker and the partly evolved surface. Stop used to kill the worker
    // and throw that surface away.
    let mgr = std::sync::Arc::new(Manager::default());
    mgr.load_session("s1", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load cube.fe");
    mgr.request("s1", json!({ "cmd": "run", "command": "r; r; r; r" })).expect("refine");

    let (tx, rx) = std::sync::mpsc::channel();
    let m = mgr.clone();
    std::thread::spawn(move || {
        let _ = tx.send(m.request("s1", json!({ "cmd": "run", "command": "g 200000" })));
    });
    std::thread::sleep(std::time::Duration::from_millis(800));

    assert!(mgr.interrupt(std::time::Duration::from_secs(5)), "the command did not stop on SIGINT");
    let res = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("request still blocked");
    let err = res.expect_err("an interrupted command reports the abort");
    assert!(err.contains("2073"), "got: {err}");

    // Same worker, same session, and the surface kept what it had evolved.
    let after = mgr.request("s1", json!({ "cmd": "run", "command": "" })).expect("session survives");
    assert!(after["energy"].as_f64().unwrap() < 6.0, "surface was reset: {after}");
}

#[test]
fn interrupt_with_nothing_running_is_a_no_op() {
    if skip() { return }
    let mgr = Manager::default();
    mgr.load_session("s1", &fe("cube.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load cube.fe");
    assert!(mgr.interrupt(std::time::Duration::from_secs(1)));
    // No stray SIGINT reached the idle engine to abort this.
    let r = mgr.request("s1", json!({ "cmd": "run", "command": "g 2" })).expect("next command runs");
    assert_eq!(r["ok"], true);
}

#[test]
fn interrupt_reaches_a_command_queued_behind_a_slow_mesh_fetch() {
    if skip() { return }
    // Found by the real-app smoke test: SE only honours SIGINT while it
    // iterates. Stop pressed during a long mesh fetch (refined foam, ~1 s)
    // lost its one SIGINT, the queued `g` then ran on, and Stop killed the
    // worker. The interrupt has to keep trying until the worker is idle.
    let mgr = std::sync::Arc::new(Manager::default());
    mgr.load_session("s1", &fe("phelanc.fe").to_string_lossy(), &worker_bin(), &lib_path())
        .expect("load phelanc.fe");
    mgr.request("s1", json!({ "cmd": "run", "command": "r; r; r; r" })).expect("refine");

    // Two callers, as in the app: the viewer's mesh fetch, and the CLI's `g`
    // queued behind it on the `io` lock.
    let m = mgr.clone();
    std::thread::spawn(move || { let _ = m.request("s1", json!({ "cmd": "mesh", "colors": true })); });
    std::thread::sleep(std::time::Duration::from_millis(50));
    let (tx, rx) = std::sync::mpsc::channel();
    let m = mgr.clone();
    std::thread::spawn(move || {
        let _ = tx.send(m.request("s1", json!({ "cmd": "run", "command": "g 200000" })));
    });
    std::thread::sleep(std::time::Duration::from_millis(250));   // inside the mesh fetch

    assert!(mgr.interrupt(std::time::Duration::from_secs(10)), "the queued command was never stopped");
    let res = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("g still running");
    assert!(res.expect_err("g reports the abort").contains("2073"));
    mgr.request("s1", json!({ "cmd": "run", "command": "" })).expect("session survives");
}
