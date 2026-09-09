//! Automates the AGENTS.md claim "all bundled `.fe` datafiles load and
//! produce facets" — previously a manual shell loop, now a real test so a
//! regression fails CI instead of waiting for someone to run the loop by
//! hand. Includes `crystal.fe`, whose `Wulff "octa.wlf"` pulls in the
//! bundle's only cross-file dependency.

mod common;
use common::{drive, repo, skip};

#[test]
fn every_bundled_fe_file_loads_and_meshes() {
    if skip() { return }

    let fe_dir = repo().join("fe");
    let mut files: Vec<_> = std::fs::read_dir(&fe_dir)
        .expect("read fe/")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "fe"))
        .collect();
    files.sort();
    assert!(files.len() >= 20, "expected at least 20 bundled .fe files, found {}", files.len());

    let mut failures = Vec::new();
    for path in &files {
        let msgs = drive(&[
            format!(r#"{{"cmd":"load","path":"{}"}}"#, path.display()),
            r#"{"cmd":"mesh"}"#.into(),
        ]);
        let name = path.file_name().unwrap().to_string_lossy();
        if msgs.len() != 2 || msgs[0]["ok"] != true || msgs[1]["ok"] != true {
            failures.push(format!("{name}: {msgs:?}"));
            continue;
        }
        let facets = msgs[1]["facets"].as_array();
        if facets.is_none_or(|f| f.is_empty()) {
            failures.push(format!("{name}: mesh produced no facets"));
        }
    }
    assert!(failures.is_empty(), "fixtures failed:\n{}", failures.join("\n"));
}
