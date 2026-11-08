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
    // Newest build wins: preferring release blindly tested a stale binary
    // left by `bun run dev` after every worker edit.
    ["release", "debug"]
        .iter()
        .map(|profile| repo_root().join("src-tauri/worker/target").join(profile).join("se-worker"))
        .filter_map(|p| Some((p.metadata().ok()?.modified().ok()?, p)))
        .max_by_key(|(mtime, _)| *mtime)
        .map(|(_, p)| p.to_string_lossy().into_owned())
}

pub fn worker_bin() -> PathBuf {
    PathBuf::from(worker_bin_str().expect("checked by skip()"))
}

/// Both a real libse and a built se-worker binary are needed. Skipping (not
/// failing) when either is missing keeps `cargo test` green on a machine
/// that hasn't run the C engine / worker build steps — same contract as
/// worker/tests/smoke.rs.
///
/// Under CI (GitHub Actions sets CI=true) a missing prerequisite fails instead:
/// there, a skip would be a silent pass.
pub fn skip() -> bool {
    let ci = std::env::var_os("CI").is_some();
    if std::env::var("SE_LIB_PATH").is_err() {
        assert!(!ci, "SE_LIB_PATH unset under CI — refusing to skip");
        eprintln!("SE_LIB_PATH unset — skipping app-layer integration test");
        return true;
    }
    if worker_bin_str().is_none() {
        assert!(!ci, "se-worker binary not found under CI — refusing to skip");
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
