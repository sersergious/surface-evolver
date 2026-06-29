# Worked example

> Illustration only. Names below (`se_get_*`, vertex/edge terms) are from one real
> codebase to make int/double dispatch and index remapping concrete. The checklist
> in SKILL.md is the normative, project-agnostic version.

## Two accessors: a double scalar and an int valence

Goal: expose a per-vertex scalar (`double` per vertex) and a per-vertex valence
(`int` per vertex). The valence is *not* read from the C lib's cached field —
that field was empty right after load — so it is counted from the edge list in
the binding. This shows both the int/double split and the recompute-from-
primitives rule.

### C (double per vertex — straightforward)

```c
// One double per vertex. Caller-allocated buf. Returns count, -1 err, 0 if N/A.
int se_get_vertex_scalar(double* buf, int max_count) {
    if (!buf || max_count <= 0) return -1;
    int n = vertex_count();
    if (n > max_count) n = max_count;
    int pos = 0;
    for (int ord = 0; ord < vertex_capacity(); ord++) {
        if (!vertex_alive(ord)) continue;       // ordinals are sparse
        if (pos >= n) break;
        buf[pos++] = vertex_scalar(ord);
    }
    return pos;
}
```

### C (int valence — recomputed, because the cached global was empty)

```c
// Valence = number of edges incident to each vertex, counted from the edge
// list. The lib's cached v->valence was 0 on load, so we recompute here.
int se_get_vertex_valence(int* buf, int max_count) {
    if (!buf || max_count <= 0) return -1;
    int n = vertex_count();
    if (n > max_count) n = max_count;
    for (int i = 0; i < n; i++) buf[i] = 0;
    for (int e = 0; e < edge_capacity(); e++) {
        if (!edge_alive(e)) continue;
        int a = vertex_position(edge_tail(e));  // ordinal -> dense position
        int b = vertex_position(edge_head(e));
        if (a >= 0 && a < n) buf[a]++;
        if (b >= 0 && b < n) buf[b]++;
    }
    return n;
}
```

`vertex_position()` is the shared ordinal→position helper — the same map the
vertex-coordinate buffer is built from, so valence[i] lines up with vertex i.

### FFI symbol map

```ts
const lib = dlopen(LIB_PATH, {
  se_get_vertex_scalar:  { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
  se_get_vertex_valence: { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
});
```

### Worker — dispatch table carries the int flag

```ts
const ACCESSORS: Record<string, { sym: string; int?: boolean }> = {
  scalar:  { sym: "se_get_vertex_scalar" },
  valence: { sym: "se_get_vertex_valence", int: true },
};

function readVertexField(name: string, maxCount: number): number[] {
  const a = ACCESSORS[name];
  const buf = a.int ? new Int32Array(maxCount) : new Float64Array(maxCount);
  const n = lib.symbols[a.sym](ptr(buf), maxCount);
  return n > 0 ? Array.from(buf.subarray(0, n)) : [];   // 0 -> [] -> UI omits
}
```

### C self-check (one runnable guard per accessor)

```c
// Load a known cube fixture: 8 vertices, each touching 3 edges.
void test_vertex_accessors(void) {
    load_fixture("cube.fe");
    double s[64]; int v[64];
    int ns = se_get_vertex_scalar(s, 64);
    int nv = se_get_vertex_valence(v, 64);
    assert(ns == 8 && nv == 8);
    for (int i = 0; i < ns; i++) assert(isfinite(s[i]));
    for (int i = 0; i < nv; i++) assert(v[i] == 3);  // cube vertex valence
}
```

## Why each gotcha showed up here

- **Stale lib:** first run after adding `se_get_vertex_valence` threw
  `dyld: Symbol not found: _se_get_vertex_valence` — the headless lib hadn't been
  rebuilt. Rebuild, confirm the worker loads the fresh `.dylib`.
- **Empty global:** `v->valence` was populated by a display/graphics module
  excluded from the headless build; it linked but stayed `0`. Hence the
  recompute-from-edges version above.
- **Sparse ordinals:** after a topology edit, vertex ordinals had gaps; the
  coordinate buffer was dense. `vertex_position()` maps one to the other so
  valence[i] matches vertex i.
- **int vs double:** valence read garbage until the worker used `Int32Array`
  instead of `Float64Array`.
