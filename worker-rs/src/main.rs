//! SE worker sidecar.
//!
//! Spawned once per session by src-tauri/src/worker.rs. Owns one libse
//! instance — `se_init` cannot run twice in a process, so the manager kills and
//! respawns this binary per loaded file.
//!
//! Protocol: line-delimited JSON on stdin/stdout.
//!   stdin  <- {"cmd":"load"|"run"|"mesh"|..., ...}
//!   stdout -> {"type":"result","ok":true|false, ...}
//!          -> {"type":"fatal","error":...}  if dlopen / se_init fails
//!
//! Cancellation: the manager kills the process (SIGTERM). No in-band cancel.
//!
//! Ported from worker/se-worker.ts (bun:ffi). Output is semantically identical;
//! serde_json renders an integral f64 as `2.0` where JSON.stringify wrote `2`,
//! which parses to the same JS number.

mod ffi;
mod handlers;

use handlers::{Worker, OUT_BUF_SIZE};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

fn send(v: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

fn fatal(error: String) -> ! {
    send(&json!({ "type": "fatal", "error": error }));
    std::process::exit(1);
}

fn main() {
    let lib_path = std::env::var("SE_LIB_PATH").unwrap_or_else(|_| "/app/libse.so".to_string());

    let se = match ffi::Se::load_library(&lib_path) {
        Ok(se) => se,
        Err(e) => fatal(format!("Failed to open library \"{lib_path}\": {e}")),
    };
    if unsafe { (se.init)() } != 0 {
        fatal("se_init() failed".to_string());
    }

    let mut w = Worker {
        se,
        out_buf: vec![0u8; OUT_BUF_SIZE],
        err_buf: vec![0u8; OUT_BUF_SIZE],
        loaded_file: None,
    };

    // Handlers are synchronous, so requests serialise naturally: a long se_run
    // blocks the loop, exactly as in the TS worker.
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // stdin closed mid-read
        };
        let line = line.trim();
        if line.is_empty() {
            continue; // blank lines get no response
        }

        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                send(&json!({ "type": "result", "ok": false, "error": "invalid JSON" }));
                continue;
            }
        };

        let cmd = req["cmd"].as_str().unwrap_or("");
        let result = match cmd {
            "load" => w.load(&req),
            "run" => w.run(&req),
            "mesh" => w.mesh(&req),
            "set_scale" => w.set_scale(&req),
            "topo" => w.topo(&req),
            "quantities" => w.quantities(),
            "vertex_info" => w.vertex_info(&req),
            "settings" => w.settings(),
            "set_settings" => w.set_settings(&req),
            "dump" => w.dump(),
            other => json!({ "ok": false, "error": format!("unknown cmd: {other}") }),
        };

        // Merge into {"type":"result", ...result} with type first, matching the
        // TS spread order.
        let mut msg = serde_json::Map::new();
        msg.insert("type".into(), json!("result"));
        if let Value::Object(m) = result {
            for (k, v) in m {
                msg.insert(k, v);
            }
        }
        send(&Value::Object(msg));
    }
    // stdin EOF -> exit 0
}
