//! Guards the one class of bug the compiler cannot catch here.
//!
//! `src/ffi.rs` declares `unsafe extern "C"` signatures for libse. Nothing
//! checks them against `engine/bindings/c/se_api.h` — a mismatched argument or
//! return type is undefined behaviour at runtime, not a compile error. This
//! test parses both files and asserts they agree, so a change to the C header
//! that isn't mirrored in Rust fails `cargo test` instead of corrupting memory
//! in production.
//!
//! It deliberately does not try to be a full C parser: the facade uses a small,
//! regular vocabulary (int / double / void / char* / int* / double*), and this
//! only needs to catch drift in it.

use std::collections::BTreeMap;
use std::path::PathBuf;

fn repo_file(rel: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("cannot read {}: {e}", p.display()))
}

/// Map a C parameter to the Rust spelling used in ffi.rs.
fn c_param_to_rust(p: &str) -> String {
    let p = p.trim();
    if p.contains('*') {
        let base = if p.contains("double") { "f64" } else if p.contains("char") { "u8" } else { "i32" };
        return format!("{}{base}", if p.contains("const") { "*const " } else { "*mut " });
    }
    if p.contains("double") { "f64".into() } else { "i32".into() }
}

/// (name) -> (args, return) from the C header.
fn parse_header(src: &str) -> BTreeMap<String, (Vec<String>, String)> {
    let mut out = BTreeMap::new();
    // Strip block comments so prototypes inside them aren't picked up.
    let mut clean = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(i) = rest.find("/*") {
        clean.push_str(&rest[..i]);
        rest = match rest[i..].find("*/") { Some(j) => &rest[i + j + 2..], None => "" };
    }
    clean.push_str(rest);

    // Prototypes may wrap across lines; join then split on ';'.
    let joined: String = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    for decl in joined.split(';') {
        let decl = decl.trim();
        let Some(open) = decl.find('(') else { continue };
        let Some(close) = decl.rfind(')') else { continue };
        let head = &decl[..open];
        let Some(name_at) = head.rfind(' ') else { continue };
        let name = head[name_at + 1..].trim_start_matches('*').trim();
        if !name.starts_with("se_") { continue }

        let ret = head[..name_at].replace('*', " ").trim().to_string();
        let ret = if ret.ends_with("char") || head[..name_at].contains('*') {
            "ptr".to_string()
        } else if ret.contains("double") { "f64".into() }
        else if ret.contains("void") { "void".into() }
        else { "i32".into() };

        let args_src = decl[open + 1..close].trim();
        let args: Vec<String> = if args_src.is_empty() || args_src == "void" {
            vec![]
        } else {
            args_src.split(',').map(c_param_to_rust).collect()
        };
        out.insert(name.to_string(), (args, ret));
    }
    out
}

/// (name without the `se_` prefix) -> (args, return) from ffi.rs.
fn parse_rust(src: &str) -> BTreeMap<String, (Vec<String>, String)> {
    let mut out = BTreeMap::new();
    let joined: String = src.split_whitespace().collect::<Vec<_>>().join(" ");
    // `pub name: unsafe extern "C" fn(ARGS) -> RET,`
    for chunk in joined.split("pub ").skip(1) {
        let Some(colon) = chunk.find(':') else { continue };
        let name = chunk[..colon].trim().to_string();
        if !chunk.contains("unsafe extern \"C\" fn(") { continue }
        let Some(open) = chunk.find("fn(") else { continue };
        let Some(close) = chunk[open..].find(')') else { continue };
        let args_src = &chunk[open + 3..open + close];
        let args: Vec<String> = if args_src.trim().is_empty() {
            vec![]
        } else {
            args_src.split(',').map(|a| a.trim().to_string()).collect()
        };
        let after = &chunk[open + close + 1..];
        let ret = if let Some(a) = after.find("->") {
            let r = after[a + 2..].split(',').next().unwrap_or("").trim();
            if r.contains("c_char") { "ptr".into() }
            else if r.contains("f64") { "f64".into() }
            else if r.contains("i32") { "i32".into() }
            else { r.to_string() }
        } else {
            "void".into()
        };
        out.insert(name, (args, ret));
    }
    out
}

#[test]
fn ffi_signatures_match_the_c_header() {
    let header = parse_header(&repo_file("engine/bindings/c/se_api.h"));
    let rust = parse_rust(&repo_file("worker-rs/src/ffi.rs"));

    // Floor, not a count: catches a parser that silently matches nothing. Raise
    // it if the facade grows; it was 30 when se_api.h exported 37, and dropped
    // to 20 when the physics/named-quantity accessors were cut (37 → 27).
    assert!(header.len() > 20, "header parse produced only {} decls — parser is broken", header.len());

    let mut problems = Vec::new();

    for (name, (c_args, c_ret)) in &header {
        let field = name.strip_prefix("se_").unwrap();
        match rust.get(field) {
            None => problems.push(format!("{name}: declared in se_api.h, missing from ffi.rs")),
            Some((r_args, r_ret)) => {
                if c_args != r_args {
                    problems.push(format!("{name}: args C={c_args:?} rust={r_args:?}"));
                }
                if c_ret != r_ret {
                    problems.push(format!("{name}: return C={c_ret} rust={r_ret}"));
                }
            }
        }
    }
    for field in rust.keys() {
        if !header.contains_key(&format!("se_{field}")) {
            problems.push(format!("se_{field}: declared in ffi.rs, missing from se_api.h"));
        }
    }

    assert!(
        problems.is_empty(),
        "ffi.rs and se_api.h disagree ({} problem(s)):\n  {}",
        problems.len(),
        problems.join("\n  ")
    );
}
