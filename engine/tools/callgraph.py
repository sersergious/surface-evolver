#!/usr/bin/env python3
"""
Surface Evolver Call Graph Builder
===================================
Parses all C source files with a lightweight regex-based extractor and generates:
  1. callgraph.dot           — full function call graph (dot/graphviz)
  2. callgraph_modules.dot   — coarse module-level graph
  3. callgraph.html          — interactive D3.js force-directed graph
  4. callgraph_report.txt    — text summary (root / leaf / internal functions)

Usage:
  python3 tools/callgraph.py [--src <src_dir>] [--out <out_dir>]
"""

import re
import json
import subprocess
import argparse
from collections import defaultdict
from pathlib import Path


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SRC_DIR = Path(__file__).parent.parent / "src"
OUT_DIR = Path(__file__).parent.parent / "build" / "callgraph"
SKIP_FILES = {"lexyy.c", "ytab.c"}      # generated lexer/parser — too noisy

# Well-known C stdlib / system identifiers to exclude from the call graph
STDLIB = {
    "printf", "fprintf", "sprintf", "snprintf", "vfprintf", "vprintf",
    "scanf", "fscanf", "sscanf",
    "malloc", "calloc", "realloc", "free",
    "memcpy", "memmove", "memset", "memcmp", "memchr",
    "strlen", "strcpy", "strncpy", "strcat", "strncat",
    "strcmp", "strncmp", "strstr", "strchr", "strrchr", "strtok",
    "fopen", "fclose", "fread", "fwrite", "fgets", "fputs",
    "feof", "ferror", "fflush", "fseek", "ftell", "rewind",
    "exit", "abort", "atexit", "getenv",
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
    "sqrt", "pow", "fabs", "exp", "log", "log10", "floor", "ceil", "fmod",
    "qsort", "bsearch", "rand", "srand",
    "tolower", "toupper", "isdigit", "isalpha", "isspace", "isalnum",
    "assert", "perror", "strerror",
    "time", "clock", "difftime",
    "atoi", "atof", "atol", "strtol", "strtod",
    "abs", "labs", "min", "max",
}

MODULE_COLORS = {
    "core":     "#AED6F1",
    "surface":  "#A9DFBF",
    "graphics": "#F9E79F",
    "other":    "#D7DBDD",
}


# ---------------------------------------------------------------------------
# Step 1: collect .c files grouped by module
# ---------------------------------------------------------------------------
def collect_sources(src_dir: Path):
    modules = {}
    for subdir in ["core", "surface", "graphics"]:
        d = src_dir / subdir
        if d.exists():
            files = sorted(f for f in d.glob("*.c") if f.name not in SKIP_FILES)
            if files:
                modules[subdir] = files
    root = sorted(f for f in src_dir.glob("*.c") if f.name not in SKIP_FILES)
    if root:
        modules["root"] = root
    return modules


# ---------------------------------------------------------------------------
# Step 2: lightweight C parser
# ---------------------------------------------------------------------------
# Matches function definitions at file scope:
#   return_type  func_name ( ... ) {
# Works for the majority of real C code; avoids full preprocessing.
FUNC_DEF_RE = re.compile(
    r'^(?:(?:static|extern|inline|__inline__|__attribute__\s*\(\([^)]*\)\))\s+)*'
    r'(?:(?:const|volatile|unsigned|signed|long|short|struct|enum|union)\s+)*'
    r'\w[\w\s\*]*?\b(\w+)\s*\([^;{()]*\)\s*\{',
    re.MULTILINE,
)

# Matches function calls: identifier followed by (
CALL_RE = re.compile(r'\b([a-zA-Z_]\w*)\s*\(')

# Strip C string literals and comments before scanning for calls
STRIP_STR_RE  = re.compile(r'"(?:[^"\\]|\\.)*"')
STRIP_CHAR_RE = re.compile(r"'(?:[^'\\]|\\.)'")
STRIP_CMT_RE  = re.compile(r'/\*.*?\*/', re.DOTALL)
STRIP_LCMT_RE = re.compile(r'//.*')


def strip_noise(src: str) -> str:
    src = STRIP_CMT_RE.sub(' ', src)
    src = STRIP_LCMT_RE.sub(' ', src)
    src = STRIP_STR_RE.sub('""', src)
    src = STRIP_CHAR_RE.sub("''", src)
    return src


def extract_functions(path: Path):
    """
    Returns list of (func_name, start, end) for all functions in file.
    Uses brace counting to find function bodies.
    """
    try:
        src = path.read_text(errors="replace")
    except OSError:
        return []

    clean = strip_noise(src)
    funcs = []

    for m in FUNC_DEF_RE.finditer(clean):
        name = m.group(1)
        # skip obvious non-functions (keywords, macro-like all-caps > 4 chars)
        if name in ("if", "while", "for", "switch", "return", "else"):
            continue
        brace_start = m.end() - 1   # position of opening '{'
        # Walk forward counting braces to find matching '}'
        depth = 0
        i = brace_start
        while i < len(clean):
            c = clean[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    funcs.append((name, brace_start, i + 1))
                    break
            i += 1

    return funcs, clean


def parse_file(path: Path):
    """
    Returns:
      defs  : set of function names defined in this file
      edges : set of (caller, callee) pairs (project-internal only, filtered later)
    """
    result = extract_functions(path)
    if not result:
        return set(), set()
    funcs, clean = result

    defs = {name for name, _, _ in funcs}
    raw_edges = set()

    for name, start, end in funcs:
        body = clean[start:end]
        for cm in CALL_RE.finditer(body):
            callee = cm.group(1)
            if callee != name and callee not in STDLIB:
                raw_edges.add((name, callee))

    return defs, raw_edges


# ---------------------------------------------------------------------------
# Step 3: build full graph, filter to project functions only
# ---------------------------------------------------------------------------
def build_graph(modules: dict):
    all_defs = {}      # func_name -> module
    all_raw_edges = set()

    for mod, files in modules.items():
        for f in files:
            defs, edges = parse_file(f)
            for d in defs:
                all_defs[d] = mod
            all_raw_edges |= edges

    # Keep only edges where callee is a known project function
    edges = {(a, b) for a, b in all_raw_edges if b in all_defs}
    return all_defs, edges


# ---------------------------------------------------------------------------
# Step 4: graphviz dot output
# ---------------------------------------------------------------------------
def write_dot(edges, func_module, out_path: Path):
    all_funcs = set(func_module.keys())
    callers = {a for a, _ in edges}
    callees = {b for _, b in edges}
    roots  = callers - callees
    leaves = all_funcs & (callees - callers)

    by_mod = defaultdict(set)
    for f, m in func_module.items():
        by_mod[m].add(f)

    lines = [
        'digraph callgraph {',
        '  rankdir=LR;',
        '  node [fontname="Helvetica" fontsize=8 style=filled];',
        '  edge [arrowsize=0.4 color="#66666688"];',
        '  overlap=false; splines=true;',
        '',
    ]
    for mod, funcs in sorted(by_mod.items()):
        color = MODULE_COLORS.get(mod, "#EEEEEE")
        lines.append(f'  subgraph cluster_{mod} {{')
        lines.append(f'    label="{mod}";')
        lines.append(f'    style=filled; color="{color}";')
        for fn in sorted(funcs):
            if fn in roots:
                shape, extra = "diamond", ' fillcolor="#e74c3c" fontcolor="white"'
            elif fn in leaves:
                shape, extra = "box", ' fillcolor="#9b59b6" fontcolor="white"'
            else:
                shape, extra = "ellipse", ""
            lines.append(f'    "{fn}" [shape={shape}{extra}];')
        lines.append('  }')
        lines.append('')

    for a, b in sorted(edges):
        lines.append(f'  "{a}" -> "{b}";')
    lines.append('}')

    out_path.write_text('\n'.join(lines))
    print(f"  Wrote {out_path}  ({len(all_funcs)} nodes, {len(edges)} edges)")
    return roots, leaves


def write_module_dot(edges, func_module, out_path: Path):
    mod_edges = defaultdict(int)
    for a, b in edges:
        ma = func_module.get(a, "other")
        mb = func_module.get(b, "other")
        if ma != mb:
            mod_edges[(ma, mb)] += 1

    lines = [
        'digraph module_callgraph {',
        '  rankdir=LR;',
        '  node [fontname="Helvetica" fontsize=16 style=filled shape=box];',
        '  edge [fontsize=11];',
        '',
    ]
    for mod, color in MODULE_COLORS.items():
        lines.append(f'  "{mod}" [fillcolor="{color}"];')
    for (ma, mb), count in sorted(mod_edges.items()):
        pw = min(1 + count / 50, 10)
        lines.append(f'  "{ma}" -> "{mb}" [label="{count} calls" penwidth={pw:.1f}];')
    lines.append('}')

    out_path.write_text('\n'.join(lines))
    print(f"  Wrote {out_path}")


# ---------------------------------------------------------------------------
# Step 5: interactive HTML (D3.js v7)
# ---------------------------------------------------------------------------
def write_html(edges, func_module, roots, leaves, out_path: Path):
    func_list = sorted(func_module.keys())
    idx = {f: i for i, f in enumerate(func_list)}

    def ntype(f):
        if f in roots:   return "root"
        if f in leaves:  return "leaf"
        return "internal"

    nodes = [{"id": i, "name": f, "module": func_module[f], "type": ntype(f)}
             for i, f in enumerate(func_list)]
    links = [{"source": idx[a], "target": idx[b]}
             for a, b in edges if a in idx and b in idx]

    nj = json.dumps(nodes)
    lj = json.dumps(links)
    n_roots  = len(roots)
    n_leaves = len(leaves)
    n_nodes  = len(nodes)
    n_edges  = len(links)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Surface Evolver — Call Graph</title>
<style>
body{{margin:0;background:#1a1a2e;font-family:'Helvetica Neue',sans-serif;color:#eee;overflow:hidden}}
#ctrl{{position:fixed;top:10px;left:10px;z-index:10;background:rgba(0,0,0,.65);
       padding:12px;border-radius:8px;min-width:230px;max-width:260px}}
#ctrl h3{{margin:0 0 8px;font-size:13px;color:#adf}}
#ctrl label{{display:block;font-size:11px;margin:4px 0;cursor:pointer}}
#ctrl input[type=range]{{width:100%}}
#search{{width:100%;box-sizing:border-box;padding:5px;border-radius:4px;
         border:1px solid #555;background:#333;color:#eee;margin-bottom:6px}}
#info{{position:fixed;bottom:10px;left:10px;background:rgba(0,0,0,.7);
       padding:10px;border-radius:8px;font-size:12px;max-width:340px;line-height:1.5}}
.legend{{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}}
.leg{{display:flex;align-items:center;gap:4px;font-size:10px}}
.dot{{width:11px;height:11px;border-radius:50%;display:inline-block}}
.sq{{width:11px;height:11px;display:inline-block}}
svg{{width:100vw;height:100vh}}
.link{{stroke:#555;stroke-opacity:.45}}
.node circle{{stroke:#222;stroke-width:1;cursor:pointer}}
.node text{{font-size:7px;fill:#ddd;pointer-events:none}}
.hl circle{{stroke:#fff!important;stroke-width:2.5!important}}
.faded{{opacity:.06!important}}
</style>
</head>
<body>
<div id="ctrl">
  <h3>Surface Evolver — Call Graph</h3>
  <input id="search" type="text" placeholder="Search function…"/>
  <label>Link distance <input type="range" id="dist" min="10" max="300" value="60"></label>
  <label>Repulsion <input type="range" id="charge" min="-600" max="-5" value="-80"></label>
  <label><input type="checkbox" id="showLeaves" checked> Show leaf nodes</label>
  <div class="legend">
    <div class="leg"><span class="dot" style="background:#AED6F1"></span>core</div>
    <div class="leg"><span class="dot" style="background:#A9DFBF"></span>surface</div>
    <div class="leg"><span class="dot" style="background:#F9E79F"></span>graphics</div>
    <div class="leg"><span class="sq" style="background:#e74c3c"></span>root (entry)</div>
    <div class="leg"><span class="dot" style="background:#9b59b6"></span>leaf</div>
  </div>
</div>
<div id="info">
  Click a node to inspect its callers/callees.<br>
  <b>Functions:</b> {n_nodes} &nbsp; <b>Edges:</b> {n_edges}<br>
  <b>Roots:</b> {n_roots} &nbsp; <b>Leaves:</b> {n_leaves}
</div>
<svg id="svg"></svg>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const nodes={nj};
const links={lj};
const MOD_COLOR={{core:"#AED6F1",surface:"#A9DFBF",graphics:"#F9E79F",other:"#D7DBDD"}};

function fillColor(d){{
  if(d.type==="root")  return"#e74c3c";
  if(d.type==="leaf")  return"#9b59b6";
  return MOD_COLOR[d.module]||"#888";
}}
function radius(d){{ return d.type==="root"?8:d.type==="leaf"?4:5; }}

const svg=d3.select("#svg");
const W=window.innerWidth, H=window.innerHeight;
const g=svg.append("g");
svg.call(d3.zoom().scaleExtent([.02,12]).on("zoom",e=>g.attr("transform",e.transform)));

const sim=d3.forceSimulation(nodes)
  .force("link",d3.forceLink(links).id(d=>d.id).distance(60))
  .force("charge",d3.forceManyBody().strength(-80))
  .force("center",d3.forceCenter(W/2,H/2))
  .force("collision",d3.forceCollide(d=>radius(d)+2));

const linkSel=g.append("g").selectAll("line").data(links).enter()
  .append("line").attr("class","link");

const nodeSel=g.append("g").selectAll("g").data(nodes).enter()
  .append("g").attr("class","node")
  .call(d3.drag()
    .on("start",(e,d)=>{{if(!e.active)sim.alphaTarget(.3).restart();d.fx=d.x;d.fy=d.y;}})
    .on("drag", (e,d)=>{{d.fx=e.x;d.fy=e.y;}})
    .on("end",  (e,d)=>{{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}}))
  .on("click",onNodeClick);

nodeSel.append("circle").attr("r",radius).attr("fill",fillColor);
nodeSel.append("text").attr("x",d=>radius(d)+2).attr("y",3).text(d=>d.name);

sim.on("tick",()=>{{
  linkSel.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y)
         .attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
  nodeSel.attr("transform",d=>`translate(${{d.x}},${{d.y}})`);
}});

// adjacency for fast lookup
const adj=new Map(nodes.map(n=>[n.id,new Set()]));
links.forEach(l=>{{
  const s=typeof l.source==="object"?l.source.id:l.source;
  const t=typeof l.target==="object"?l.target.id:l.target;
  adj.get(s).add(t); adj.get(t).add(s);
}});

let sel=null;
function onNodeClick(e,d){{
  if(sel===d.id){{reset();return;}}
  sel=d.id;
  const nb=adj.get(d.id);
  nodeSel.classed("faded",n=>n.id!==d.id&&!nb.has(n.id));
  nodeSel.classed("hl",n=>n.id===d.id);
  linkSel.classed("faded",l=>{{
    const s=l.source.id??l.source, t=l.target.id??l.target;
    return s!==d.id&&t!==d.id;
  }});
  const callees=links.filter(l=>(l.source.id??l.source)===d.id).map(l=>l.target.name??nodes[(l.target.id??l.target)].name);
  const callers=links.filter(l=>(l.target.id??l.target)===d.id).map(l=>l.source.name??nodes[(l.source.id??l.source)].name);
  document.getElementById("info").innerHTML=
    `<b>${{d.name}}</b> [<i>${{d.module}}</i> · <i>${{d.type}}</i>]<br>`+
    `Callers (${{callers.length}}): ${{callers.slice(0,10).join(", ")}}${{callers.length>10?"…":""}}<br>`+
    `Callees (${{callees.length}}): ${{callees.slice(0,10).join(", ")}}${{callees.length>10?"…":""}}`;
}}
function reset(){{
  sel=null;
  nodeSel.classed("faded",false).classed("hl",false);
  linkSel.classed("faded",false);
  document.getElementById("info").innerHTML=
    `Click a node to inspect its callers/callees.<br>`+
    `<b>Functions:</b> {n_nodes} &nbsp; <b>Edges:</b> {n_edges}<br>`+
    `<b>Roots:</b> {n_roots} &nbsp; <b>Leaves:</b> {n_leaves}`;
}}
svg.on("click",e=>{{if(e.target===svg.node())reset();}});

document.getElementById("search").addEventListener("input",function(){{
  const q=this.value.toLowerCase();
  nodeSel.classed("faded",d=>q&&!d.name.toLowerCase().includes(q));
}});
document.getElementById("dist").addEventListener("input",function(){{
  sim.force("link").distance(+this.value); sim.alpha(.3).restart();
}});
document.getElementById("charge").addEventListener("input",function(){{
  sim.force("charge").strength(+this.value); sim.alpha(.3).restart();
}});
document.getElementById("showLeaves").addEventListener("change",function(){{
  nodeSel.classed("faded",d=>!this.checked&&d.type==="leaf");
}});
</script>
</body>
</html>"""
    out_path.write_text(html)
    print(f"  Wrote {out_path}")


# ---------------------------------------------------------------------------
# Step 6: text report
# ---------------------------------------------------------------------------
def write_report(edges, func_module, roots, leaves, out_path: Path):
    all_funcs = set(func_module.keys())
    internal = all_funcs - roots - leaves

    callee_count  = defaultdict(int)
    caller_count  = defaultdict(int)
    callees_of    = defaultdict(set)
    callers_of    = defaultdict(set)
    for a, b in edges:
        callee_count[a]  += 1
        caller_count[b]  += 1
        callees_of[a].add(b)
        callers_of[b].add(a)

    lines = [
        "Surface Evolver — Call Graph Report",
        "=" * 70, "",
        f"Total project functions : {len(all_funcs)}",
        f"Total call edges        : {len(edges)}",
        f"Root functions          : {len(roots)}   (nothing calls them — likely entry points)",
        f"Leaf functions          : {len(leaves)}  (call no other project function — pure utils/math)",
        f"Internal functions      : {len(internal)}",
        "",
        "ROOT FUNCTIONS (entry points / top-level commands)",
        "-" * 70,
    ]
    for f in sorted(roots):
        mod = func_module.get(f, "?")
        lines.append(f"  {f:45s} [{mod}]  calls {callee_count[f]} project funcs")

    lines += ["",
              "LEAF FUNCTIONS (no outgoing project calls — pure utilities / math helpers)",
              "-" * 70]
    for f in sorted(leaves):
        mod = func_module.get(f, "?")
        lines.append(f"  {f:45s} [{mod}]  called by {caller_count[f]} funcs")

    lines += ["",
              "TOP 20 MOST-CALLED FUNCTIONS (highest in-degree)",
              "-" * 70]
    by_callers = sorted(all_funcs, key=lambda f: -caller_count[f])[:20]
    for f in by_callers:
        mod = func_module.get(f, "?")
        lines.append(f"  {f:45s} [{mod}]  called by {caller_count[f]} funcs")

    lines += ["",
              "TOP 20 MOST-CALLING FUNCTIONS (highest out-degree)",
              "-" * 70]
    by_callees = sorted(all_funcs, key=lambda f: -callee_count[f])[:20]
    for f in by_callees:
        mod = func_module.get(f, "?")
        lines.append(f"  {f:45s} [{mod}]  calls {callee_count[f]} project funcs")

    out_path.write_text('\n'.join(lines))
    print(f"  Wrote {out_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", default=str(SRC_DIR))
    parser.add_argument("--out", default=str(OUT_DIR))
    args = parser.parse_args()

    src_dir = Path(args.src)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Collecting source files...")
    modules = collect_sources(src_dir)
    total = sum(len(v) for v in modules.values())
    for mod, files in modules.items():
        print(f"  {mod}: {len(files)} files")

    print(f"\nParsing {total} C files...")
    func_module, edges = build_graph(modules)
    all_funcs = set(func_module.keys())
    callers = {a for a, _ in edges}
    callees = {b for _, b in edges}
    roots  = callers - callees
    leaves = all_funcs & (callees - callers)
    print(f"  {len(all_funcs)} functions, {len(edges)} edges, "
          f"{len(roots)} roots, {len(leaves)} leaves")

    print("\nGenerating outputs...")
    write_dot(edges, func_module, out_dir / "callgraph.dot")
    write_module_dot(edges, func_module, out_dir / "callgraph_modules.dot")
    write_html(edges, func_module, roots, leaves, out_dir / "callgraph.html")
    write_report(edges, func_module, roots, leaves, out_dir / "callgraph_report.txt")

    print("\nRendering with graphviz...")
    # Module-level: small, render as PNG + SVG
    for fmt, flag in [("svg", "-Tsvg"), ("png", "-Tpng -Gdpi=150")]:
        out = out_dir / f"callgraph_modules.{fmt}"
        subprocess.run(f"dot {flag} {out_dir}/callgraph_modules.dot -o {out}",
                       shell=True, check=False)
        print(f"  Rendered {out}")
    # Full graph: use sfdp (faster for large graphs), SVG only
    svg_out = out_dir / "callgraph.svg"
    subprocess.run(f"sfdp -Tsvg -Goverlap=prism {out_dir}/callgraph.dot -o {svg_out}",
                   shell=True, check=False)
    print(f"  Rendered {svg_out}")

    print(f"\nDone!")
    print(f"  Interactive explorer : {out_dir}/callgraph.html  (open in browser)")
    print(f"  Module overview PNG  : {out_dir}/callgraph_modules.png")
    print(f"  Full graph SVG       : {out_dir}/callgraph.svg")
    print(f"  Text report          : {out_dir}/callgraph_report.txt")


if __name__ == "__main__":
    main()
