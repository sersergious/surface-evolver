//! End-to-end smoke test: drives the built worker binary over stdin/stdout
//! exactly as src-tauri/src/worker.rs does, and asserts the response contract.
//!
//! Needs a built libse and the bundled fe/ files, so it is skipped unless
//! SE_LIB_PATH points at one:
//!
//!   SE_LIB_PATH=$PWD/../cmake-build-debug/libse.dylib cargo test
//!
//! Skipping-when-unconfigured is deliberate: `cargo test` must stay green on a
//! machine that has not built the C engine. CI builds libse first, so it runs
//! there.

use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Feed the worker a script of commands; collect one JSON reply per line.
fn drive(lines: &[String]) -> Vec<Value> {
    let bin = PathBuf::from(env!("CARGO_BIN_EXE_se-worker"));
    let lib = std::env::var("SE_LIB_PATH").expect("checked by caller");

    let mut child = Command::new(bin)
        .env("SE_LIB_PATH", lib)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn worker");
    {
        let stdin = child.stdin.as_mut().unwrap();
        for l in lines {
            writeln!(stdin, "{l}").unwrap();
        }
    }
    let out = child.wait_with_output().expect("worker exited");
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("bad JSON {l}: {e}")))
        .collect()
}

fn cube() -> String {
    format!(r#"{{"cmd":"load","path":"{}"}}"#, repo().join("fe/cube.fe").display())
}

fn skip() -> bool {
    if std::env::var("SE_LIB_PATH").is_err() {
        eprintln!("SE_LIB_PATH unset — skipping worker smoke test");
        return true;
    }
    false
}

#[test]
fn every_command_round_trips() {
    if skip() { return }
    let msgs = drive(&[
        cube(),
        r#"{"cmd":"run","command":"r; g 20"}"#.into(),
        r#"{"cmd":"mesh","colors":true}"#.into(),
        r#"{"cmd":"quantities"}"#.into(),
        r#"{"cmd":"settings"}"#.into(),
        r#"{"cmd":"topo","op":"refine"}"#.into(),
        r#"{"cmd":"vertex_info","vpos":0}"#.into(),
        r#"{"cmd":"set_scale","scale":0.05}"#.into(),
        r#"{"cmd":"dump"}"#.into(),
    ]);
    assert_eq!(msgs.len(), 9, "one reply per command");
    for (i, m) in msgs.iter().enumerate() {
        assert_eq!(m["type"], "result", "msg{i} missing type");
        assert_eq!(m["ok"], true, "msg{i} not ok: {m}");
    }

    // load
    assert_eq!(msgs[0]["sdim"], 3);
    assert_eq!(msgs[0]["vertex_count"], 14);
    assert!(msgs[0]["bbox_min"].is_array());

    // run: the cube must have evolved toward the sphere
    let e = msgs[1]["energy"].as_f64().unwrap();
    assert!(e > 4.8 && e < 6.0, "energy after evolve looks wrong: {e}");

    // mesh: geometry present, colours present because requested, and every
    // facet index must be in range — this is the buffer-bounds contract.
    let mesh = &msgs[2];
    let verts = mesh["vertices"].as_array().unwrap();
    let facets = mesh["facets"].as_array().unwrap();
    assert!(!verts.is_empty() && !facets.is_empty());
    assert_eq!(mesh["facet_colors"].as_array().unwrap().len(), facets.len());
    for f in facets {
        for idx in f.as_array().unwrap() {
            let i = idx.as_u64().unwrap() as usize;
            assert!(i < verts.len(), "facet index {i} out of range ({} verts)", verts.len());
        }
    }
    for v in verts {
        assert_eq!(v.as_array().unwrap().len(), 3, "vertices are always stride 3");
    }
    assert!(mesh["body_volumes"].is_object());

    // topo reports deltas
    assert!(msgs[5]["counts"].is_object());
    assert!(msgs[5]["energy_delta"].is_f64());

    // dump returns a reloadable datafile
    let content = msgs[8]["content"].as_str().unwrap();
    assert!(content.contains("vertices"), "dump does not look like a datafile");
}

#[test]
fn mesh_omits_colours_unless_requested() {
    if skip() { return }
    let msgs = drive(&[cube(), r#"{"cmd":"mesh"}"#.into()]);
    let mesh = &msgs[1];
    // Absent entirely, not null — the frontend distinguishes these.
    assert!(mesh.get("facet_colors").is_none(), "facet_colors must be absent");
    assert!(mesh.get("edge_colors").is_none(), "edge_colors must be absent");
}

#[test]
fn string_model_2d_loads_and_reports_bodies() {
    if skip() { return }
    // 100grain.fe is sdim=2 STRING: 0 facets, but 100 bodies and real edges.
    // Regression guard for the fixed-stride-3 vertex buffer.
    let path = repo().join("fe/100grain.fe");
    let msgs = drive(&[
        format!(r#"{{"cmd":"load","path":"{}"}}"#, path.display()),
        r#"{"cmd":"mesh","colors":true}"#.into(),
    ]);
    assert_eq!(msgs[0]["ok"], true);
    assert_eq!(msgs[0]["sdim"], 2);
    let mesh = &msgs[1];
    assert_eq!(mesh["facets"].as_array().unwrap().len(), 0, "STRING model has no facets");
    assert!(!mesh["edges"].as_array().unwrap().is_empty());
    assert_eq!(mesh["body_volumes"].as_object().unwrap().len(), 100);
    for v in mesh["vertices"].as_array().unwrap() {
        assert_eq!(v.as_array().unwrap().len(), 3, "2-D verts still emit 3 comps (z padded)");
    }
}

#[test]
fn bad_input_is_reported_not_fatal() {
    if skip() { return }
    let msgs = drive(&[
        "{ not json".into(),
        r#"{"cmd":"totally_unknown"}"#.into(),
        cube(),
        r#"{"cmd":"set_scale","scale":0}"#.into(),
        r#"{"cmd":"run","command":"f"}"#.into(),
        r#"{"cmd":"vertex_info","vpos":99999999}"#.into(),
        r#"{"cmd":"mesh"}"#.into(),   // still alive afterwards
    ]);
    assert_eq!(msgs.len(), 7, "worker must answer every line and stay up");
    assert_eq!(msgs[0]["error"], "invalid JSON");
    assert!(msgs[1]["error"].as_str().unwrap().starts_with("unknown cmd:"));
    assert_eq!(msgs[3]["ok"], false);
    // interactive commands report via se_error, which the manager surfaces
    assert!(msgs[4]["se_error"].as_str().unwrap().contains("interactive"));
    assert_eq!(msgs[5]["ok"], false);
    assert_eq!(msgs[6]["ok"], true, "worker survived the bad input above");
}

#[test]
fn blank_lines_get_no_reply() {
    if skip() { return }
    let msgs = drive(&["".into(), "   ".into(), cube()]);
    assert_eq!(msgs.len(), 1, "blank lines must not produce a response");
}
