//! Shared helpers for driving the built `se-worker` binary over stdin/stdout,
//! exactly as `src-tauri/src/worker.rs` does. Used by both smoke.rs and
//! fixtures.rs — kept here once both needed it.
//!
//! Each integration test binary compiles this module separately, so a helper
//! unused by one binary (e.g. `cube()` in fixtures.rs) would warn there.

#![allow(dead_code)]

use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

pub fn repo() -> PathBuf {
    // ../.. — this crate lives at src-tauri/worker/, so the repo root is two up.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The worker binary under test. SE_WORKER_PATH lets CI drive the shipped
/// release build (panic = "abort", LTO, opt-level "z") instead of the
/// dev-profile binary cargo test builds.
pub fn worker_bin() -> PathBuf {
    std::env::var_os("SE_WORKER_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_se-worker")))
}

/// Feed the worker a script of commands; collect one JSON reply per line.
pub fn drive(lines: &[String]) -> Vec<Value> {
    drive_env(lines, &[])
}

/// `drive`, with extra environment variables for the worker process.
pub fn drive_env(lines: &[String], env: &[(&str, &std::path::Path)]) -> Vec<Value> {
    let bin = worker_bin();
    let lib = std::env::var("SE_LIB_PATH").expect("checked by caller");

    let mut child = Command::new(bin)
        .env("SE_LIB_PATH", lib)
        .envs(env.iter().copied())
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

/// A `load` request, built with serde_json so any path is escaped correctly
/// (a backslash or quote in a hand-formatted one made invalid JSON).
pub fn load(path: &std::path::Path) -> String {
    serde_json::json!({ "cmd": "load", "path": path }).to_string()
}

pub fn cube() -> String {
    load(&repo().join("fe/cube.fe"))
}

/// Skip when no engine is configured, so a fresh checkout stays green — except
/// under CI (GitHub Actions sets CI=true), where a skip would be a silent pass.
pub fn skip() -> bool {
    if std::env::var("SE_LIB_PATH").is_err() {
        assert!(std::env::var_os("CI").is_none(), "SE_LIB_PATH unset under CI — refusing to skip");
        eprintln!("SE_LIB_PATH unset — skipping worker smoke test");
        return true;
    }
    false
}
