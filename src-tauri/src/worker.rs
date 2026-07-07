//! SE subprocess manager — port of src/main/src/se-manager.ts.
//!
//! Each load kills the previous worker and spawns a fresh `se-worker` sidecar
//! that owns exactly one libse instance (se_init cannot run twice in one
//! process). The `io` mutex serialises all request/response I/O; the separate
//! `proc` mutex lets a new load kill a hung worker without waiting on `io`.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

pub struct WorkerIo {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    pub active_session: String,
}

#[derive(Default)]
pub struct Manager {
    /// Held for the duration of every request/response exchange.
    pub io: Mutex<Option<WorkerIo>>,
    /// Process handle only — kill() takes this without touching `io`.
    pub proc: Mutex<Option<Child>>,
}

fn read_result(stdout: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    loop {
        let mut line = String::new();
        let n = stdout
            .read_line(&mut line)
            .map_err(|e| format!("SE worker read failed: {e}"))?;
        if n == 0 {
            return Err("SE engine process crashed — reload the file to continue"
                .to_string());
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value =
            serde_json::from_str(line).map_err(|e| format!("SE worker sent bad JSON: {e}"))?;
        match msg["type"].as_str() {
            Some("result") => return Ok(msg),
            // dlopen / se_init failure — surface the real cause.
            Some("fatal") => {
                return Err(format!(
                    "SE engine failed to start: {}",
                    msg["error"].as_str().unwrap_or("unknown error")
                ))
            }
            _ => continue, // progress lines are dropped (parity with se-manager.ts)
        }
    }
}

fn check_result(msg: &Value) -> Result<(), String> {
    if msg["ok"].as_bool() == Some(true) {
        return Ok(());
    }
    let text = msg["se_error"].as_str()
        .or_else(|| msg["error"].as_str())
        .unwrap_or("SE worker returned an error");
    Err(text.to_string())
}

impl Manager {
    pub fn kill(&self) {
        if let Some(mut child) = self.proc.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait(); // reap; blocked reader gets EOF and errors out
        }
    }

    pub fn load_session(
        &self,
        session_id: &str,
        fe_path: &str,
        worker_bin: &PathBuf,
        lib_path: &PathBuf,
    ) -> Result<Value, String> {
        // Kill BEFORE taking `io`: a hung command holds `io` until its blocked
        // read fails, so killing first breaks the deadlock (se-manager.ts note).
        self.kill();
        let mut io = self.io.lock().unwrap();
        *io = None;

        let mut cmd = Command::new(worker_bin);
        cmd.env("SE_LIB_PATH", lib_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn SE worker ({}): {e}", worker_bin.display()))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        *self.proc.lock().unwrap() = Some(child);
        *io = Some(WorkerIo { stdin, stdout, active_session: session_id.to_string() });

        let w = io.as_mut().unwrap();
        send(&mut w.stdin, &json!({ "cmd": "load", "path": fe_path }))?;
        let msg = read_result(&mut w.stdout)?;
        check_result(&msg)?;
        Ok(msg)
    }

    /// Send `req` to the active worker for `session_id`, await its result line.
    pub fn request(&self, session_id: &str, req: Value) -> Result<Value, String> {
        let mut io = self.io.lock().unwrap();
        let w = io.as_mut().ok_or_else(|| {
            format!("No active SE worker for session {session_id}")
        })?;
        if w.active_session != session_id {
            return Err(format!(
                "Session {session_id} is not currently loaded (active: {})",
                w.active_session
            ));
        }
        send(&mut w.stdin, &req)?;
        match read_result(&mut w.stdout) {
            Ok(msg) => {
                check_result(&msg)?;
                Ok(msg)
            }
            Err(e) => {
                *io = None; // worker died mid-request — clean slate for next load
                Err(e)
            }
        }
    }
}

fn send(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    writeln!(stdin, "{msg}").map_err(|e| format!("SE worker write failed: {e}"))
}
