//! RPC dispatch — port of the Electrobun handlers in src/main/src/index.ts.
//! The webview calls invoke("rpc", { method, params }); one command keeps the
//! frontend client a single function, matching the old Electroview.rpc shape.

use crate::worker::Manager;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager as TauriManager, State};
use tauri_plugin_opener::OpenerExt;

const MAX_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
// Datafiles hidden from the picker (see index.ts for the why).
const QUARANTINED_FE: [&str; 2] = ["slidestr.fe", "simplex3.fe"];

#[derive(Default)]
pub struct AppState {
    pub manager: Manager,
    pub sessions: Mutex<HashMap<String, Value>>,
    /// None = restore not attempted yet; Some(v) = memoized result (v may be null).
    pub restore: Mutex<Option<Value>>,
}

// ── path resolution (port of bootstrap-paths.ts + config.ts) ───────────────

fn state_dir() -> PathBuf {
    std::env::var("SE_STATE_DIR").map(PathBuf::from).unwrap_or_else(|_| {
        dirs_home().join(".surface-evolver")
    })
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE")) // Windows
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn user_fe_dir() -> PathBuf {
    state_dir().join("fe")
}

fn resource_dir(app: &AppHandle) -> PathBuf {
    app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn bundled_fe_dir(app: &AppHandle) -> PathBuf {
    std::env::var("SE_FE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| resource_dir(app).join("fe"))
}

fn lib_path(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("SE_LIB_PATH") {
        return PathBuf::from(p);
    }
    let (os, ext) = if cfg!(target_os = "macos") {
        ("macos", "dylib")
    } else if cfg!(target_os = "windows") {
        ("windows", "dll")
    } else {
        ("linux", "so")
    };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    resource_dir(app).join("native").join(format!("libse-{os}-{arch}.{ext}"))
}

fn worker_bin(_app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("SE_WORKER_PATH") {
        return PathBuf::from(p);
    }
    // Tauri places externalBin next to the app executable in dev and bundle.
    let name = if cfg!(target_os = "windows") { "se-worker.exe" } else { "se-worker" };
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().map(|d| d.join(name)).unwrap_or_default()
}

fn sanitize(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    base.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .collect()
}

/// User files shadow bundled ones of the same name.
fn resolve_fe_path(app: &AppHandle, fe_file: &str) -> PathBuf {
    let name = sanitize(fe_file);
    let user = user_fe_dir().join(&name);
    if user.exists() { user } else { bundled_fe_dir(app).join(&name) }
}

fn now_iso() -> String {
    // RFC3339 UTC without a chrono dep: seconds precision is plenty here.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    let (h, m, s) = ((secs % 86400) / 3600, (secs % 3600) / 60, secs % 60);
    // civil-from-days (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

// ── session helpers ─────────────────────────────────────────────────────────

fn session_from_stats(session_id: &str, fe_file: &str, stats: &Value) -> Value {
    json!({
        "session_id": session_id,
        "fe_file": fe_file,
        "energy": stats["energy"],
        "area": stats["area"],
        "scale": stats["scale"],
        "sdim": stats["sdim"],
        "vertex_count": stats["vertex_count"],
        "edge_count": stats["edge_count"],
        "facet_count": stats["facet_count"],
        "lagrange_order": stats["lagrange_order"],
        "last_accessed": now_iso(),
    })
}

fn get_session(state: &AppState, params: &Value) -> Result<(String, Value), String> {
    let sid = params["sessionId"]
        .as_str()
        .ok_or("sessionId is required")?
        .to_string();
    let sessions = state.sessions.lock().unwrap();
    let s = sessions.get(&sid).ok_or("Session not found")?.clone();
    Ok((sid, s))
}

fn update_session(state: &AppState, sid: &str, result: &Value) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(s) = sessions.get_mut(sid) {
        for k in ["energy", "area", "scale"] {
            if !result[k].is_null() {
                s[k] = result[k].clone();
            }
        }
        s["last_accessed"] = json!(now_iso());
    }
}

// ── persistence (port of persistence.ts — best-effort, never surfaces) ─────

fn persist_file() -> PathBuf {
    state_dir().join("last-session.json")
}

fn persist(app: &AppHandle, sid: &str) {
    let state: State<AppState> = app.state();
    let fe_file = {
        let sessions = state.sessions.lock().unwrap();
        match sessions.get(sid) {
            Some(s) => s.clone(),
            None => return,
        }
    };
    if let Ok(dump) = state.manager.request(sid, json!({ "cmd": "dump" })) {
        let saved = json!({
            "fe_file": fe_file["fe_file"],
            "energy": fe_file["energy"],
            "area": fe_file["area"],
            "dmp": dump["content"],
            "saved_at": now_iso(),
        });
        let _ = fs::create_dir_all(state_dir());
        let _ = fs::write(persist_file(), saved.to_string());
    }
}

fn try_restore(app: &AppHandle, state: &AppState) -> Value {
    let Ok(raw) = fs::read_to_string(persist_file()) else { return Value::Null };
    let Ok(saved) = serde_json::from_str::<Value>(&raw) else { return Value::Null };
    let (Some(dmp), Some(fe_file)) = (saved["dmp"].as_str(), saved["fe_file"].as_str()) else {
        return Value::Null;
    };
    let tmp = std::env::temp_dir().join(format!("se-restore-{}.dmp", uuid::Uuid::new_v4()));
    if fs::write(&tmp, dmp).is_err() {
        return Value::Null;
    }
    let sid = uuid::Uuid::new_v4().to_string();
    let loaded = state.manager.load_session(
        &sid,
        &tmp.to_string_lossy(),
        &worker_bin(app),
        &lib_path(app),
    );
    let _ = fs::remove_file(&tmp);
    match loaded {
        Ok(stats) => {
            let session = session_from_stats(&sid, fe_file, &stats);
            state.sessions.lock().unwrap().insert(sid, session.clone());
            session
        }
        Err(_) => {
            let _ = fs::remove_file(persist_file()); // corrupt snapshot — drop it
            Value::Null
        }
    }
}

// ── the command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn rpc(app: AppHandle, method: String, params: Value) -> Result<Value, String> {
    // Worker I/O blocks (a `g N` can run minutes) — keep it off the event loop.
    tauri::async_runtime::spawn_blocking(move || dispatch(&app, &method, params))
        .await
        .map_err(|e| e.to_string())?
}

fn dispatch(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let state: State<AppState> = app.state();
    match method {
        "getRestore" => {
            let mut memo = state.restore.lock().unwrap();
            if memo.is_none() {
                *memo = Some(try_restore(app, &state));
            }
            Ok(memo.clone().unwrap())
        }

        "listFiles" => {
            let list = |dir: &Path| -> Vec<String> {
                fs::read_dir(dir)
                    .map(|rd| {
                        rd.filter_map(|e| e.ok())
                            .map(|e| e.file_name().to_string_lossy().into_owned())
                            .filter(|f| f.ends_with(".fe") && !QUARANTINED_FE.contains(&f.as_str()))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let mut files: Vec<String> = list(&bundled_fe_dir(app));
            files.extend(list(&user_fe_dir()));
            files.sort();
            files.dedup();
            Ok(json!(files))
        }

        "createSession" => {
            let fe_file = params["fe_file"].as_str().ok_or("fe_file is required")?;
            let fe_path = resolve_fe_path(app, fe_file);
            if !fe_path.exists() {
                return Err(format!("File not found: {}", sanitize(fe_file)));
            }
            let sid = uuid::Uuid::new_v4().to_string();
            let stats = state
                .manager
                .load_session(&sid, &fe_path.to_string_lossy(), &worker_bin(app), &lib_path(app))
                ?;
            let session = session_from_stats(&sid, fe_file, &stats);
            state.sessions.lock().unwrap().insert(sid.clone(), session.clone());
            persist(app, &sid);
            Ok(session)
        }

        "uploadFile" => {
            let filename = params["filename"].as_str().ok_or("filename and content are required")?;
            let content = params["content"].as_str().ok_or("filename and content are required")?;
            if !filename.ends_with(".fe") {
                return Err("Only .fe files are accepted".into());
            }
            let safe = sanitize(filename);
            if resolve_fe_path(app, &safe).exists() {
                return Err(format!("File '{safe}' already exists — rename and retry"));
            }
            let buf = base64_decode(content).ok_or("content is not valid base64")?;
            if buf.len() > MAX_UPLOAD_BYTES {
                return Err("File exceeds 5 MB limit".into());
            }
            fs::create_dir_all(user_fe_dir()).map_err(|e| e.to_string())?;
            fs::write(user_fe_dir().join(&safe), &buf).map_err(|e| e.to_string())?;
            let renderable = !QUARANTINED_FE.contains(&safe.as_str());
            Ok(json!({ "filename": safe, "size_bytes": buf.len(), "renderable": renderable }))
        }

        "exportDmp" => {
            let (sid, session) = get_session(&state, &params)?;
            let result = state.manager.request(&sid, json!({ "cmd": "dump" }))?;
            let fe = session["fe_file"].as_str().unwrap_or("surface");
            let stem = Path::new(fe).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "surface".into());
            let ts = now_iso().replace([':', '.'], "-");
            let ts = &ts[..ts.len().min(19)];
            Ok(json!({ "filename": format!("{stem}_{ts}.dmp"), "content": result["content"] }))
        }

        "exportFe" => {
            let (_sid, session) = get_session(&state, &params)?;
            let fe = session["fe_file"].as_str().unwrap_or_default();
            let content = fs::read_to_string(resolve_fe_path(app, fe)).map_err(|e| e.to_string())?;
            Ok(json!({ "filename": sanitize(fe), "content": content }))
        }

        "updateFile" => {
            let filename = params["filename"].as_str().ok_or("filename and content are required")?;
            let content = params["content"].as_str().ok_or("filename and content are required")?;
            if content.len() > MAX_UPLOAD_BYTES {
                return Err("File exceeds 5 MB limit".into());
            }
            let safe = sanitize(filename);
            fs::create_dir_all(user_fe_dir()).map_err(|e| e.to_string())?;
            fs::write(user_fe_dir().join(&safe), content).map_err(|e| e.to_string())?;
            Ok(json!({ "filename": safe, "size_bytes": content.len() }))
        }

        "saveExport" => {
            let filename = params["filename"].as_str().ok_or("filename and content are required")?;
            let content = params["content"].as_str().ok_or("filename and content are required")?;
            let safe = sanitize(filename);
            let dir = dirs_home().join("Downloads");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            // Avoid clobbering: foo.dmp, foo (1).dmp, ...
            let (stem, ext) = match safe.rfind('.') {
                Some(i) if i > 0 => (&safe[..i], &safe[i..]),
                _ => (safe.as_str(), ""),
            };
            let mut dest = dir.join(&safe);
            let mut i = 1;
            while dest.exists() {
                dest = dir.join(format!("{stem} ({i}){ext}"));
                i += 1;
            }
            fs::write(&dest, content).map_err(|e| e.to_string())?;
            let _ = app.opener().reveal_item_in_dir(&dest); // reveal is best-effort
            Ok(json!({ "path": dest.to_string_lossy() }))
        }

        "setScale" => {
            let (sid, _) = get_session(&state, &params)?;
            let scale = params["scale"].as_f64().filter(|s| *s > 0.0)
                .ok_or("scale must be a positive number")?;
            let result = state.manager
                .request(&sid, json!({ "cmd": "set_scale", "scale": scale }))
                ?;
            update_session(&state, &sid, &result);
            Ok(result)
        }

        "runCommand" => {
            let (sid, _) = get_session(&state, &params)?;
            let command = params["command"].as_str().filter(|c| !c.is_empty())
                .ok_or("command is required")?;
            let result = state.manager
                .request(&sid, json!({ "cmd": "run", "command": command }))
                ?;
            update_session(&state, &sid, &result);
            persist(app, &sid);
            Ok(result)
        }

        "getMesh" => {
            let (sid, _) = get_session(&state, &params)?;
            let mut req = json!({ "cmd": "mesh" });
            if params["colors"].as_bool() == Some(true) {
                req["colors"] = json!(true);
            }
            state.manager.request(&sid, req)
        }

        "quantities" => {
            let (sid, _) = get_session(&state, &params)?;
            state.manager.request(&sid, json!({ "cmd": "quantities" }))
        }

        "settings" => {
            let (sid, _) = get_session(&state, &params)?;
            state.manager.request(&sid, json!({ "cmd": "settings" }))
        }

        "setSettings" => {
            let (sid, _) = get_session(&state, &params)?;
            let mut req = json!({ "cmd": "set_settings" });
            for k in ["mesh_params", "physics"] {
                if !params[k].is_null() {
                    req[k] = params[k].clone();
                }
            }
            let result = state.manager.request(&sid, req)?;
            update_session(&state, &sid, &result);
            persist(app, &sid);
            Ok(result)
        }

        "vertexInfo" => {
            let (sid, _) = get_session(&state, &params)?;
            let vpos = params["vpos"].as_i64().filter(|v| *v >= 0).ok_or("vpos is required")?;
            state.manager
                .request(&sid, json!({ "cmd": "vertex_info", "vpos": vpos }))
                
        }

        "topo" => {
            let (sid, _) = get_session(&state, &params)?;
            let op = params["op"].as_str().filter(|o| !o.is_empty()).ok_or("op is required")?;
            let mut req = json!({ "cmd": "topo", "op": op });
            if let Some(n) = params["n"].as_i64() {
                req["n"] = json!(n);
            }
            let result = state.manager.request(&sid, req)?;
            update_session(&state, &sid, &result);
            persist(app, &sid);
            Ok(result)
        }

        other => Err(format!("Unknown RPC method: {other}")),
    }
}

// Tiny base64 decoder — avoids a dependency for one call site.
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    const TBL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut rev = [255u8; 256];
    for (i, &c) in TBL.iter().enumerate() {
        rev[c as usize] = i as u8;
    }
    let s: Vec<u8> = s.bytes().filter(|b| !b" \n\r\t".contains(b)).collect();
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    for chunk in s.chunks(4) {
        let mut vals = [0u8; 4];
        let mut len = 0;
        for (i, &c) in chunk.iter().enumerate() {
            if c == b'=' {
                break;
            }
            let v = rev[c as usize];
            if v == 255 {
                return None;
            }
            vals[i] = v;
            len = i + 1;
        }
        if len >= 2 {
            out.push((vals[0] << 2) | (vals[1] >> 4));
        }
        if len >= 3 {
            out.push((vals[1] << 4) | (vals[2] >> 2));
        }
        if len == 4 {
            out.push((vals[2] << 6) | vals[3]);
        }
    }
    Some(out)
}
