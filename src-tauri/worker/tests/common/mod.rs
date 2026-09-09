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

/// Feed the worker a script of commands; collect one JSON reply per line.
pub fn drive(lines: &[String]) -> Vec<Value> {
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

pub fn cube() -> String {
    format!(r#"{{"cmd":"load","path":"{}"}}"#, repo().join("fe/cube.fe").display())
}

pub fn skip() -> bool {
    if std::env::var("SE_LIB_PATH").is_err() {
        eprintln!("SE_LIB_PATH unset — skipping worker smoke test");
        return true;
    }
    false
}
