//! Command handlers — a 1:1 port of worker/se-worker.ts.
//!
//! Output shapes are semantically identical to the TS worker (same keys, same
//! value types, same present/absent behaviour). Byte-identity is not a goal:
//! serde_json prints an integral f64 as `2.0` where JSON.stringify prints `2`,
//! and both parse to the same JS number on the far side.

use crate::ffi::Se;
use serde_json::{json, Map, Value};

pub const OUT_BUF_SIZE: usize = 256 * 1024;
const NAME_SIZE: i32 = 128;
const MAX_CONS: i32 = 32;
const TOPO_COUNT: i32 = 11;

/// Must match SE_TOPO_COUNT / se_get_topo_counts ordering in se_api.c.
const TOPO_NAMES: [&str; 11] = [
    "equi", "edge_refine", "facet_refine", "vertex_dissolve", "edge_dissolve",
    "facet_dissolve", "vertex_pop", "edge_pop", "edgeswap", "fix", "unfix",
];

/// Bare single-letter SE commands whose handlers call prompt() for keyboard
/// input. stdin here is the IPC pipe, so they would block forever. A compound
/// like "f; g" still escapes this check — same limitation as the TS worker.
const INTERACTIVE_CMDS: [&str; 18] = [
    "a", "b", "f", "G", "J", "j", "k", "K", "l", "m", "n", "p", "t", "w", "W", "y", "Z", "F",
];

pub struct Worker {
    pub se: Se,
    pub out_buf: Vec<u8>,
    pub err_buf: Vec<u8>,
    pub loaded_file: Option<String>,
}

/// NUL-terminated bytes for a C string argument.
fn cstring(s: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(s.len() + 1);
    v.extend_from_slice(s.as_bytes());
    v.push(0);
    v
}

/// Decode a fixed C buffer up to its NUL. Lossy: SE writes raw bytes with no
/// UTF-8 guarantee, and JS's TextDecoder substitutes U+FFFD rather than failing.
fn cstr(buf: &[u8]) -> String {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

impl Worker {
    fn pop_output(&mut self) -> String {
        let n = unsafe { (self.se.pop_output)(self.out_buf.as_mut_ptr(), OUT_BUF_SIZE as i32) };
        if n > 0 { String::from_utf8_lossy(&self.out_buf[..n as usize]).into_owned() } else { String::new() }
    }

    fn pop_errout(&mut self) -> String {
        let n = unsafe { (self.se.pop_errout)(self.err_buf.as_mut_ptr(), OUT_BUF_SIZE as i32) };
        if n > 0 { String::from_utf8_lossy(&self.err_buf[..n as usize]).into_owned() } else { String::new() }
    }

    fn last_error(&self) -> String {
        let p = unsafe { (self.se.last_error)() };
        if p.is_null() { return String::new() }
        unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned()
    }

    /// popErrout() || lastError() || fallback — the TS `||` chain, so an empty
    /// errout falls through rather than being reported as an empty message.
    fn se_error(&mut self, fallback: &str) -> String {
        let e = self.pop_errout();
        if !e.is_empty() { return e }
        let l = self.last_error();
        if !l.is_empty() { return l }
        fallback.to_string()
    }

    // ── load ────────────────────────────────────────────────────────────────

    pub fn load(&mut self, req: &Value) -> Value {
        let path = match req["path"].as_str() {
            Some(p) => p.to_string(),
            None => return json!({ "ok": false, "error": "path is required" }),
        };
        // Resolve relative includes (e.g. crystal.fe's `Wulff "octa.wlf"`)
        // against the datafile's own directory; the engine opens them relative
        // to the CWD. Failure is deliberately swallowed.
        if let Some(dir) = std::path::Path::new(&path).parent() {
            let _ = std::env::set_current_dir(dir);
        }

        let ret = unsafe { (self.se.load)(cstring(&path).as_ptr()) };
        if ret != 0 {
            let msg = self.se_error("se_load() failed");
            return json!({ "ok": false, "se_error": msg });
        }
        self.loaded_file = Some(path);

        let sdim = unsafe { (self.se.get_sdim)() };
        // Bounding box is the one sdim-wide buffer in the API. Guard against a
        // non-positive sdim so we never allocate 0/negative and hand C a
        // dangling pointer (the TS hits a RangeError here instead).
        let (bbox_min, bbox_max) = if sdim > 0 {
            let mut lo = vec![0f64; sdim as usize];
            let mut hi = vec![0f64; sdim as usize];
            let n = unsafe { (self.se.get_bounding_box)(lo.as_mut_ptr(), hi.as_mut_ptr()) };
            if n > 0 { (json!(lo), json!(hi)) } else { (Value::Null, Value::Null) }
        } else {
            (Value::Null, Value::Null)
        };

        unsafe {
            json!({
                "ok": true,
                "energy": (self.se.get_energy)(),
                "area": (self.se.get_area)(),
                "scale": (self.se.get_scale)(),
                "sdim": sdim,
                "vertex_count": (self.se.get_vertex_count)(),
                "edge_count": (self.se.get_edge_count)(),
                "facet_count": (self.se.get_facet_count)(),
                "lagrange_order": (self.se.get_lagrange_order)(),
                "bbox_min": bbox_min,
                "bbox_max": bbox_max,
                "total_time": (self.se.get_total_time)(),
            })
        }
    }

    // ── run ─────────────────────────────────────────────────────────────────

    pub fn run(&mut self, req: &Value) -> Value {
        let cmd = match req["command"].as_str() {
            Some(c) => c,
            None => return json!({ "ok": false, "error": "command is required" }),
        };
        let trimmed = cmd.trim();
        if INTERACTIVE_CMDS.contains(&trimmed) {
            return json!({
                "ok": false,
                "se_error": format!(
                    "Command \"{trimmed}\" requires interactive keyboard input, which this UI does not support."
                ),
            });
        }
        let ret = unsafe { (self.se.run)(cstring(cmd).as_ptr()) };
        if ret != 0 {
            let msg = self.se_error("se_run() failed");
            return json!({ "ok": false, "se_error": msg });
        }
        let output = self.pop_output();
        unsafe {
            json!({
                "ok": true,
                "output": output,
                "energy": (self.se.get_energy)(),
                "area": (self.se.get_area)(),
                "total_time": (self.se.get_total_time)(),
            })
        }
    }

    // ── mesh ────────────────────────────────────────────────────────────────

    pub fn mesh(&mut self, req: &Value) -> Value {
        let want_colors = req["colors"].as_bool().unwrap_or(false);

        // se_get_vertices writes a FIXED stride of 3 regardless of sdim (see
        // se_api.h) — do not size this by sdim.
        let vcount = unsafe { (self.se.get_vertex_count)() };
        let mut vertices: Vec<Value> = Vec::new();
        let mut vertex_ids: Vec<i32> = Vec::new();
        if vcount > 0 {
            let mut vbuf = vec![0f64; vcount as usize * 3];
            let mut idbuf = vec![0i32; vcount as usize];
            let vn = unsafe { (self.se.get_vertices)(vbuf.as_mut_ptr(), vcount) };
            unsafe { (self.se.get_vertex_ids)(idbuf.as_mut_ptr(), vcount) };
            for i in 0..vn.max(0) as usize {
                vertices.push(json!([vbuf[i * 3], vbuf[i * 3 + 1], vbuf[i * 3 + 2]]));
                vertex_ids.push(idbuf[i]);
            }
        }

        let fcount = unsafe { (self.se.get_facet_count)() };
        let mut facets: Vec<Value> = Vec::new();
        if fcount > 0 {
            let mut fbuf = vec![0i32; fcount as usize * 3];
            let fn_ = unsafe { (self.se.get_facets)(fbuf.as_mut_ptr(), fcount) };
            for i in 0..fn_.max(0) as usize {
                facets.push(json!([fbuf[i * 3], fbuf[i * 3 + 1], fbuf[i * 3 + 2]]));
            }
        }

        let ecount = unsafe { (self.se.get_edge_count)() };
        let mut edges: Vec<Value> = Vec::new();
        if ecount > 0 {
            let mut ebuf = vec![0i32; ecount as usize * 2];
            let en = unsafe { (self.se.get_edges)(ebuf.as_mut_ptr(), ecount) };
            for i in 0..en.max(0) as usize {
                edges.push(json!([ebuf[i * 2], ebuf[i * 2 + 1]]));
            }
        }

        // Keys are 1-based strings for display; body_cms stays a 0-based array.
        // Both index the same FOR_ALL_BODIES order — different labelling, not a
        // mismatch. Map preserves insertion order (serde_json preserve_order),
        // so "9" precedes "10" as in JS.
        let bcount = unsafe { (self.se.get_body_count)() };
        let mut body_volumes = Map::new();
        let mut body_pressures = Map::new();
        let mut body_cms: Vec<Value> = Vec::new();
        if bcount > 0 {
            let mut vol = vec![0f64; bcount as usize];
            let mut pre = vec![0f64; bcount as usize];
            unsafe { (self.se.get_body_volumes)(vol.as_mut_ptr(), pre.as_mut_ptr(), bcount) };
            let mut cm = [0f64; 3];
            for i in 0..bcount {
                let k = (i + 1).to_string();
                body_volumes.insert(k.clone(), json!(vol[i as usize]));
                body_pressures.insert(k, json!(pre[i as usize]));
                let r = unsafe { (self.se.get_body_cm)(i, cm.as_mut_ptr()) };
                body_cms.push(if r == 3 { json!([cm[0], cm[1], cm[2]]) } else { Value::Null });
            }
        }

        let mut out = Map::new();
        out.insert("ok".into(), json!(true));
        out.insert("vertices".into(), json!(vertices));
        out.insert("vertex_ids".into(), json!(vertex_ids));
        out.insert("facets".into(), json!(facets));
        out.insert("edges".into(), json!(edges));
        out.insert("body_volumes".into(), Value::Object(body_volumes));
        out.insert("body_pressures".into(), Value::Object(body_pressures));
        out.insert("body_cms".into(), json!(body_cms));

        // Colour keys are absent entirely unless requested (not null).
        if want_colors {
            let mut facet_colors: Vec<i32> = Vec::new();
            let mut edge_colors: Vec<i32> = Vec::new();
            if fcount > 0 {
                let mut front = vec![0i32; fcount as usize];
                let mut back = vec![0i32; fcount as usize];
                let cn = unsafe {
                    (self.se.get_facet_colors)(front.as_mut_ptr(), back.as_mut_ptr(), fcount)
                };
                facet_colors.extend_from_slice(&front[..cn.max(0) as usize]);
            }
            if ecount > 0 {
                let mut ec = vec![0i32; ecount as usize];
                let cn = unsafe { (self.se.get_edge_colors)(ec.as_mut_ptr(), ecount) };
                edge_colors.extend_from_slice(&ec[..cn.max(0) as usize]);
            }
            out.insert("facet_colors".into(), json!(facet_colors));
            out.insert("edge_colors".into(), json!(edge_colors));
        }
        Value::Object(out)
    }

    // ── topo ────────────────────────────────────────────────────────────────

    fn topo_counts(&self) -> [i32; 11] {
        let mut buf = [0i32; 11];
        unsafe { (self.se.get_topo_counts)(buf.as_mut_ptr(), TOPO_COUNT) };
        buf
    }

    fn element_counts(&self) -> (i32, i32, i32, i32) {
        unsafe {
            (
                (self.se.get_vertex_count)(),
                (self.se.get_edge_count)(),
                (self.se.get_facet_count)(),
                (self.se.get_body_count)(),
            )
        }
    }

    pub fn topo(&mut self, req: &Value) -> Value {
        let op = match req["op"].as_str() {
            Some(o) => o,
            None => return json!({ "ok": false, "error": "op is required" }),
        };
        let n = match req["n"].as_f64() {
            Some(v) if v > 0.0 => v.floor() as i64,
            _ => 1,
        };
        // `pop` needs a generator — bare `pop` is a syntax error.
        let cmd = match op {
            "refine" => "r".to_string(),
            "equi" => format!("u {n}"),
            "vertex_avg" => "V".to_string(),
            "pop" => "pop vertices".to_string(),
            other => return json!({ "ok": false, "error": format!("unknown topology op: {other}") }),
        };

        let c0 = self.topo_counts();
        let e0 = self.element_counts();
        let energy_start = unsafe { (self.se.get_energy)() };

        let ret = unsafe { (self.se.run)(cstring(&cmd).as_ptr()) };
        if ret != 0 {
            let msg = self.se_error("topology op failed");
            return json!({ "ok": false, "se_error": msg });
        }

        let c1 = self.topo_counts();
        let e1 = self.element_counts();

        // Insertion order matches the TS: element deltas first, then the named
        // counters in TOPO_NAMES order. Only non-zero deltas are emitted.
        let mut counts = Map::new();
        for (name, a, b) in [
            ("vertices", e0.0, e1.0), ("edges", e0.1, e1.1),
            ("facets", e0.2, e1.2), ("bodies", e0.3, e1.3),
        ] {
            if a != b { counts.insert(name.into(), json!(b - a)); }
        }
        for i in 0..TOPO_COUNT as usize {
            let d = c1[i] - c0[i];
            if d != 0 { counts.insert(TOPO_NAMES[i].into(), json!(d)); }
        }

        let output = self.pop_output();
        let energy = unsafe { (self.se.get_energy)() };
        unsafe {
            json!({
                "ok": true,
                "output": output,
                "counts": Value::Object(counts),
                "energy": energy,
                "energy_delta": energy - energy_start,
                "area": (self.se.get_area)(),
                "total_time": (self.se.get_total_time)(),
            })
        }
    }

    // ── quantities ──────────────────────────────────────────────────────────

    pub fn quantities(&mut self) -> Value {
        let mut name = vec![0u8; NAME_SIZE as usize];
        let (mut d0, mut d1, mut d2) = (0f64, 0f64, 0f64);
        let mut i0 = 0i32;

        let mut quantities: Vec<Value> = Vec::new();
        let qc = unsafe { (self.se.get_quantity_count)() };
        for i in 0..qc.max(0) {
            let r = unsafe {
                (self.se.get_quantity)(
                    i, name.as_mut_ptr(), NAME_SIZE,
                    &mut d0, &mut d1, &mut d2, &mut i0,
                )
            };
            if r == 0 {
                quantities.push(json!({
                    "name": cstr(&name), "value": d0,
                    "target": d1, "modulus": d2, "flags": i0,
                }));
            }
        }

        let mut methods: Vec<Value> = Vec::new();
        let mc = unsafe { (self.se.get_method_instance_count)() };
        for i in 0..mc.max(0) {
            let r = unsafe {
                (self.se.get_method_instance)(i, name.as_mut_ptr(), NAME_SIZE, &mut i0, &mut d0)
            };
            if r == 0 {
                methods.push(json!({ "name": cstr(&name), "type": i0, "value": d0 }));
            }
        }
        json!({ "ok": true, "quantities": quantities, "methods": methods })
    }

    // ── vertex_info ─────────────────────────────────────────────────────────

    pub fn vertex_info(&mut self, req: &Value) -> Value {
        let vpos = match req["vpos"].as_i64() {
            Some(v) if v >= 0 => v as i32,
            _ => return json!({ "ok": false, "error": "vpos is required" }),
        };
        let mut id = 0i32;
        let mut xyz = [0f64; 3]; // fixed 3, like se_get_vertices
        let mut attr = 0i32;
        let mut cons = [0i32; MAX_CONS as usize];

        let nc = unsafe {
            (self.se.get_vertex_info)(
                vpos, &mut id, xyz.as_mut_ptr(), &mut attr, cons.as_mut_ptr(), MAX_CONS,
            )
        };
        if nc < 0 {
            return json!({ "ok": false, "error": "invalid vertex position" });
        }

        let mut name = vec![0u8; NAME_SIZE as usize];
        let mut constraints: Vec<Value> = Vec::new();
        for &ci in &cons[..nc.min(MAX_CONS) as usize] {
            let r = unsafe { (self.se.get_constraint_name)(ci, name.as_mut_ptr(), NAME_SIZE) };
            constraints.push(json!({ "idx": ci, "name": if r == 0 { cstr(&name) } else { String::new() } }));
        }
        json!({
            "ok": true, "id": id, "xyz": [xyz[0], xyz[1], xyz[2]],
            "attr": attr, "constraints": constraints,
        })
    }

    // ── settings ────────────────────────────────────────────────────────────

    fn read_settings(&self) -> (Value, Value, f64) {
        let mut mp = [0f64; 4];
        let mut ph = [0f64; 4];
        unsafe {
            (self.se.get_mesh_params)(mp.as_mut_ptr(), 4);
            (self.se.get_physics)(ph.as_mut_ptr(), 4);
        }
        (
            json!({ "min_area": mp[0], "min_length": mp[1], "max_len": mp[2], "temperature": mp[3] }),
            json!({ "gravflag": ph[0] != 0.0, "grav_const": ph[1], "pressflag": ph[2] != 0.0, "pressure": ph[3] }),
            unsafe { (self.se.get_total_time)() },
        )
    }

    pub fn settings(&mut self) -> Value {
        let (mesh_params, physics, total_time) = self.read_settings();
        json!({ "ok": true, "mesh_params": mesh_params, "physics": physics, "total_time": total_time })
    }

    pub fn set_settings(&mut self, req: &Value) -> Value {
        if let Some(m) = req["mesh_params"].as_object() {
            // Validate in the declared field order so the error names the same
            // field the TS would have named.
            for k in ["min_area", "min_length", "max_len", "temperature"] {
                let v = m.get(k).and_then(|v| v.as_f64());
                match v {
                    Some(v) if v.is_finite() && v > 0.0 => {}
                    _ => return json!({ "ok": false, "error": format!("invalid {k}: must be a positive finite number") }),
                }
            }
            unsafe {
                (self.se.set_mesh_params)(
                    m["min_area"].as_f64().unwrap(), m["min_length"].as_f64().unwrap(),
                    m["max_len"].as_f64().unwrap(), m["temperature"].as_f64().unwrap(),
                )
            };
        }
        if let Some(p) = req["physics"].as_object() {
            // grav/pressure may legitimately be negative or zero -> finite only.
            let g = p.get("grav_const").and_then(|v| v.as_f64());
            let pr = p.get("pressure").and_then(|v| v.as_f64());
            match (g, pr) {
                (Some(g), Some(pr)) if g.is_finite() && pr.is_finite() => unsafe {
                    (self.se.set_physics)(
                        g,
                        p.get("gravflag").and_then(|v| v.as_bool()).unwrap_or(false) as i32,
                        pr,
                        p.get("pressflag").and_then(|v| v.as_bool()).unwrap_or(false) as i32,
                    );
                },
                _ => return json!({ "ok": false, "error": "grav_const/pressure must be finite numbers" }),
            }
        }
        // recalc through the protected command path so energy/area refresh.
        unsafe { (self.se.run)(cstring("recalc").as_ptr()) };
        self.pop_output();

        let (mesh_params, physics, total_time) = self.read_settings();
        unsafe {
            json!({
                "ok": true, "mesh_params": mesh_params, "physics": physics,
                "total_time": total_time,
                "energy": (self.se.get_energy)(), "area": (self.se.get_area)(),
            })
        }
    }

    pub fn set_scale(&mut self, req: &Value) -> Value {
        let scale = match req["scale"].as_f64() {
            Some(s) if s > 0.0 => s,
            _ => return json!({ "ok": false, "error": "scale must be a positive number" }),
        };
        unsafe { (self.se.set_scale)(scale) };
        unsafe {
            json!({
                "ok": true,
                "scale": (self.se.get_scale)(),
                "energy": (self.se.get_energy)(),
                "area": (self.se.get_area)(),
            })
        }
    }

    // ── dump ────────────────────────────────────────────────────────────────

    pub fn dump(&mut self) -> Value {
        if self.loaded_file.is_none() {
            return json!({ "ok": false, "error": "No file loaded" });
        }
        // Dump to an explicit temp path: a bare `dump` writes next to the
        // datafile, whose directory can be read-only (translocated .app).
        let path = std::env::temp_dir().join(format!("se-dump-{}.dmp", std::process::id()));
        let p = path.to_string_lossy().into_owned();

        let ret = unsafe { (self.se.run)(cstring(&format!("dump \"{p}\"")).as_ptr()) };
        if ret != 0 {
            let msg = self.se_error("dump failed");
            let _ = std::fs::remove_file(&path);
            return json!({ "ok": false, "se_error": msg });
        }
        self.pop_output();

        let out = match std::fs::read(&path) {
            Ok(bytes) => json!({ "ok": true, "content": String::from_utf8_lossy(&bytes) }),
            Err(e) => json!({ "ok": false, "error": format!("Could not read dump file at {p}: {e}") }),
        };
        let _ = std::fs::remove_file(&path);
        out
    }
}
