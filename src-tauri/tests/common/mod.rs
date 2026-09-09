//! Shared helpers for the app-layer integration tests (manager.rs, dispatch.rs).
//! Both need a real built libse and a real built se-worker binary — this repo
//! has no workspace tying src-tauri to src-tauri/worker (Landmine 3), so
//! nothing hands us those paths automatically the way `CARGO_BIN_EXE_*` does
//! within a single crate.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

pub fn fe(name: &str) -> PathBuf {
    repo_root().join("fe").join(name)
}

pub fn lib_path() -> PathBuf {
    PathBuf::from(std::env::var("SE_LIB_PATH").expect("checked by skip()"))
}

fn worker_bin_str() -> Option<String> {
    if let Ok(p) = std::env::var("SE_WORKER_PATH") {
        return Some(p);
    }
    ["release", "debug"].iter().find_map(|profile| {
        let p = repo_root().join("src-tauri/worker/target").join(profile).join("se-worker");
        p.exists().then(|| p.to_string_lossy().into_owned())
    })
}

pub fn worker_bin() -> PathBuf {
    PathBuf::from(worker_bin_str().expect("checked by skip()"))
}

/// Both a real libse and a built se-worker binary are needed. Skipping (not
/// failing) when either is missing keeps `cargo test` green on a machine
/// that hasn't run the C engine / worker build steps — same contract as
/// worker/tests/smoke.rs.
pub fn skip() -> bool {
    if std::env::var("SE_LIB_PATH").is_err() {
        eprintln!("SE_LIB_PATH unset — skipping app-layer integration test");
        return true;
    }
    if worker_bin_str().is_none() {
        eprintln!("se-worker binary not found (set SE_WORKER_PATH or build src-tauri/worker) — skipping");
        return true;
    }
    false
}

/// A fresh scratch directory under the OS temp dir, namespaced by pid + a
/// caller-given tag so parallel test binaries never collide.
pub fn scratch_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("se-apptest-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}
