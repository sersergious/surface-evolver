//! SE subprocess manager: spawns, talks to, and kills the se-worker sidecar.
//!
//! Each load kills the previous worker and spawns a fresh `se-worker` sidecar
//! that owns exactly one libse instance (se_init cannot run twice in one
//! process). The `io` mutex serialises all request/response I/O; the separate
//! `proc` mutex lets a new load kill a hung worker without waiting on `io`.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};

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

/// Poison here means an earlier RPC panicked while holding the guard. Every
/// thing we lock is an `Option` or a map that stays structurally valid, so
/// recovering the inner value beats `unwrap()` bricking every later call.
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
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
            _ => continue, // progress lines are dropped
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
        if let Some(mut child) = lock(&self.proc).take() {
            let _ = child.kill();
            let _ = child.wait(); // reap; blocked reader gets EOF and errors out
        }
    }

    /// Ask a running command to stop while keeping the surface (#35). SE's
    /// SIGINT handler aborts the command ("ERROR 2073: Command aborted due
    /// to user interrupt"), and the worker and its partly evolved surface
    /// survive. Returns true once no request holds `io` (also when nothing
    /// was running: an idle worker gets no signal), false if the command
    /// did not stop within `grace`, so the caller can fall back to kill().
    /// Like kill(), takes only `proc` and never waits on `io`.
    ///
    /// SE only honours SIGINT while it iterates: one that lands during a mesh
    /// fetch is lost, and a `g` queued behind the fetch then runs on. So the
    /// signal is re-sent every RESEND until the worker is idle. A stray one at
    /// an idle worker is harmless (measured: the next command runs normally).
    // ponytail: a new request that grabs `io` right after the interrupted
    // one releases it reads as "still running" and ends in a kill; the UI
    // blocks new commands while one runs, so this is not reachable from it.
    pub fn interrupt(&self, grace: Duration) -> bool {
        let idle = || !matches!(self.io.try_lock(), Err(TryLockError::WouldBlock));
        if idle() {
            return true;
        }
        let Some(pid) = lock(&self.proc).as_ref().map(|c| c.id()) else { return false };
        extern "C" { fn kill(pid: i32, sig: i32) -> i32; }
        const SIGINT: i32 = 2; // the same on macOS and Linux
        const RESEND: Duration = Duration::from_millis(250);
        let deadline = Instant::now() + grace;
        let mut next_signal = Instant::now();
        while Instant::now() < deadline {
            if idle() {
                return true;
            }
            if Instant::now() >= next_signal {
                unsafe { kill(pid as i32, SIGINT) };
                next_signal = Instant::now() + RESEND;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    /// Whether a worker process is alive (or at least not yet reaped). Takes
    /// only `proc`, like kill(), so it never waits behind a running command.
    pub fn has_worker(&self) -> bool {
        lock(&self.proc).is_some()
    }

    pub fn load_session(
        &self,
        session_id: &str,
        fe_path: &str,
        worker_bin: &PathBuf,
        lib_path: &PathBuf,
    ) -> Result<Value, String> {
        // Kill BEFORE taking `io`: a hung command holds `io` until its blocked
        // read fails, so killing first breaks the deadlock.
        self.kill();
        let mut io = lock(&self.io);
        *io = None;

        let mut cmd = Command::new(worker_bin);
        cmd.env("SE_LIB_PATH", lib_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn SE worker ({}): {e}", worker_bin.display()))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        *lock(&self.proc) = Some(child);
        *io = Some(WorkerIo { stdin, stdout, active_session: session_id.to_string() });

        let w = io.as_mut().unwrap();
        let result = (|| {
            send(&mut w.stdin, &json!({ "cmd": "load", "path": fe_path }))?;
            let msg = read_result(&mut w.stdout)?;
            check_result(&msg)?;
            Ok(msg)
        })();
        if result.is_err() {
            // Engine state after a failed se_load is undefined — don't leave
            // this worker registered as the active session.
            *io = None;
            self.kill();
        }
        result
    }

    /// Send `req` to the active worker for `session_id`, await its result line.
    pub fn request(&self, session_id: &str, req: Value) -> Result<Value, String> {
        let mut io = lock(&self.io);
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
                // Only an EOF read means the worker actually died — a pipe error
                // or a bad JSON line leaves it running. Reap it either way, or it
                // holds libse until the next load (or forever, if there isn't one).
                *io = None;
                self.kill();
                Err(e)
            }
        }
    }
}

fn send(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    writeln!(stdin, "{msg}").map_err(|e| format!("SE worker write failed: {e}"))
}
