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
        r#"{"cmd":"topo","op":"refine"}"#.into(),
        r#"{"cmd":"vertex_info","vpos":0}"#.into(),
        r#"{"cmd":"dump"}"#.into(),
    ]);
    assert_eq!(msgs.len(), 6, "one reply per command");
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
    assert!(msgs[3]["counts"].is_object());
    assert!(msgs[3]["energy_delta"].is_f64());

    // dump returns a reloadable datafile
    let content = msgs[5]["content"].as_str().unwrap();
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
fn string_model_is_rejected_at_load() {
    if skip() { return }
    // se_load accepts SOAPFILM only: STRING facets are arbitrary polygons, so
    // se_get_facets() reports none and the surface would draw as a bare edge
    // web. The bundled STRING datafiles were removed alongside that gate, so
    // this writes its own — the point is the contract, not any one file.
    let dir = std::env::temp_dir().join(format!("se-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("string_tri.fe");
    std::fs::write(&path, concat!(
        "STRING\n",
        "space_dimension 2\n\n",
        "vertices\n1  0.0 0.0\n2  1.0 0.0\n3  0.5 1.0\n\n",
        "edges\n1   1 2\n2   2 3\n3   3 1\n",
    )).unwrap();

    let msgs = drive(&[format!(r#"{{"cmd":"load","path":"{}"}}"#, path.display())]);
    let _ = std::fs::remove_dir_all(&dir);

    assert_eq!(msgs[0]["ok"], false, "STRING datafile must not load");
    let err = msgs[0]["se_error"].as_str().unwrap_or_default().to_lowercase();
    assert!(
        err.contains("soapfilm") && err.contains("string"),
        "error must name both the supported model and the rejected one, got: {err}"
    );
}

#[test]
fn bad_input_is_reported_not_fatal() {
    if skip() { return }
    let msgs = drive(&[
        "{ not json".into(),
        r#"{"cmd":"totally_unknown"}"#.into(),
        cube(),
        r#"{"cmd":"topo","op":"nonsense"}"#.into(),
        r#"{"cmd":"run","command":"f"}"#.into(),
        r#"{"cmd":"vertex_info","vpos":99999999}"#.into(),
        r#"{"cmd":"mesh"}"#.into(),   // still alive afterwards
    ]);
    assert_eq!(msgs.len(), 7, "worker must answer every line and stay up");
    assert_eq!(msgs[0]["error"], "invalid JSON");
    assert!(msgs[1]["error"].as_str().unwrap().starts_with("unknown cmd:"));
    // bad *parameter* to a known command — distinct from the unknown-cmd case
    assert_eq!(msgs[3]["ok"], false);
    assert!(msgs[3]["error"].as_str().unwrap().starts_with("unknown topology op:"));
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

#[test]
fn periodic_wrap_edges_are_hidden() {
    if skip() { return }
    // phelanc.fe is TORUS_FILLED. An edge crossing a period boundary has no
    // honest straight-line form — drawn as-is it spans the domain, which is
    // what BACKLOG F1 measured (103 of 368 edges). The mesh must omit those
    // and report how many, without mutating the surface (no `detorus`).
    let path = repo().join("fe/phelanc.fe");
    let msgs = drive(&[
        format!(r#"{{"cmd":"load","path":"{}"}}"#, path.display()),
        r#"{"cmd":"mesh","colors":true}"#.into(),
    ]);
    let total = msgs[0]["edge_count"].as_u64().unwrap();
    let mesh = &msgs[1];

    let hidden = mesh["wrapped_edges_hidden"].as_u64().expect("periodic file must report it");
    let edges = mesh["edges"].as_array().unwrap();
    assert!(hidden > 0);
    assert_eq!(edges.len() as u64 + hidden, total, "drawn + hidden must equal every edge");
    assert_eq!(
        mesh["edge_colors"].as_array().unwrap().len(),
        edges.len(),
        "edge_colors must stay index-aligned with the filtered edges"
    );

    // The actual defect: wrap-around edges render as lines across the whole
    // domain. What remains must be uniform — no edge many times the median.
    let verts: Vec<Vec<f64>> = mesh["vertices"].as_array().unwrap().iter()
        .map(|v| v.as_array().unwrap().iter().map(|c| c.as_f64().unwrap()).collect())
        .collect();
    let mut lens: Vec<f64> = edges.iter().map(|e| {
        let (a, b) = (e[0].as_u64().unwrap() as usize, e[1].as_u64().unwrap() as usize);
        (0..3).map(|k| (verts[a][k] - verts[b][k]).powi(2)).sum::<f64>().sqrt()
    }).collect();
    lens.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let (median, max) = (lens[lens.len() / 2], *lens.last().unwrap());
    assert!(max < median * 5.0, "edge spanning the domain still drawn: max {max} vs median {median}");
}

#[test]
fn non_periodic_mesh_hides_nothing() {
    if skip() { return }
    // The same code path must be a no-op on a plain surface — and must not
    // touch E_WRAP_ATTR, which has no storage without a symmetry group.
    let msgs = drive(&[cube(), r#"{"cmd":"mesh","colors":true}"#.into()]);
    let mesh = &msgs[1];
    assert!(mesh.get("wrapped_edges_hidden").is_none(), "key must be absent, not 0");
    assert_eq!(
        mesh["edges"].as_array().unwrap().len() as u64,
        msgs[0]["edge_count"].as_u64().unwrap(),
        "no edge may be dropped from a non-periodic surface"
    );
}
