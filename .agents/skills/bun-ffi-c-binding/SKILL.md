---
name: bun-ffi-c-binding
description: "Add a new data accessor to a C library exposed to a TypeScript/Bun frontend via bun:ffi, touching every layer in order. Use when: adding a new accessor/data field to a C library wrapped via bun:ffi, especially with a worker subprocess + IPC/RPC layer to a frontend."
---

# bun:ffi C Accessor Wiring

> One new C accessor means edits at 8 layers; miss one (usually the rebuild) and you get a runtime `dyld: Symbol not found`, not a compile error.

## Quick Reference

| Problem | Solution |
|---------|----------|
| `dyld: Symbol not found: _lib_get_X` at runtime | Rebuild the shared lib AND make sure the worker/test loads the fresh copy |
| FFI returns garbage / zeros for a field | The C global is computed only in a build module excluded from your target; recompute from primitives |
| Indices from C don't line up with the JS buffer rows | C ordinals are sparse; build one ordinal→position map and reuse it |
| New `int` field reads wrong values, `double` ones fine | Typed-array mismatch — `int` needs `Int32Array`, `double` needs `Float64Array` |
| UI shows an error for a field that's just "N/A" | Distinguish `-1` (error) from `0` (valid but empty/unsupported) |
| Adding the 3rd, 4th... accessor is copy-paste hell | Replace per-field branches with a dispatch table keyed by field name |

## The Problem

You have a C library loaded into a Bun process through `bun:ffi`, often inside a worker subprocess whose results travel up an IPC/RPC channel to a frontend. You need to expose one more piece of data (a per-element scalar, an index list, a count). The work is spread across the C source, the C header, the compiled artifact, the FFI symbol map, the worker, the IPC layer, the frontend types, and the UI. Skipping any layer fails silently or at runtime, and the failure mode (`dyld: Symbol not found`, garbage buffers, misaligned indices) does not point at the missing layer.

## Solutions

### Option 1: Walk every layer in order (Recommended)

Add one accessor `T lib_get_X(OUT* buf, int max_count)` by editing each layer below, in this order. The order matters: the rebuild (step 3) gates everything after it.

**1. C function.** Fill a caller-allocated flat buffer. Return the count written, `-1` on error, `0` when valid-but-empty/unsupported. Never return malloc'd memory across the FFI boundary.

```c
// Writes up to max_count doubles into buf (one per element).
// Returns number written, -1 on error, 0 if not applicable.
int lib_get_density(double* buf, int max_count) {
    if (!buf || max_count <= 0) return -1;
    int n = element_count();
    if (n > max_count) n = max_count;
    for (int i = 0; i < n; i++) buf[i] = element_at(i)->density;
    return n;
}
```

**2. C header.** Declare it and document, in a comment, the buffer ownership (caller-allocated), the packing/stride (e.g. `[x,y,z, x,y,z, ...]`), and the return semantics (`count` / `-1` / `0`).

```c
// buf: caller-allocated, length >= max_count. Packing: 1 double per element.
// Returns count written, -1 on error, 0 if unsupported. Caller owns buf.
int lib_get_density(double* buf, int max_count);
```

**3. Rebuild the shared library.** `.so` / `.dylib` / `.dll` — rebuild before the FFI side can see the symbol. A stale artifact gives `dyld: Symbol not found` at *runtime*, not compile time. If a test binary links its own copy of the lib, reconfigure the build so it picks up the fresh one.

**4. FFI SYMBOLS map.** args/returns must match the C signature exactly.

```ts
const lib = dlopen(LIB_PATH, {
  lib_get_density: { returns: FFIType.int, args: [FFIType.ptr, FFIType.int] },
});
```

**5. Worker handler.** Allocate the typed array matching the C element type, pass `ptr(buf)`, slice to the returned count.

```ts
const buf = new Float64Array(maxCount);          // Int32Array for int accessors
const n = lib.symbols.lib_get_density(ptr(buf), maxCount);
const values = n > 0 ? Array.from(buf.subarray(0, n)) : [];
```

**6. IPC/RPC passthrough.** If the manager forwards the raw worker message, new fields flow automatically — only the TS return *type* needs updating. No new transport code.

**7. Frontend API type.** Add the field to the response interface.

```ts
interface MeshResponse {
  // ...existing fields
  density?: number[];   // optional: absent when accessor returned 0
}
```

**8. UI consumer.** Wire the hook/state and the control that selects the field.

### Option 2: Dispatch table (generalize once you have >2 accessors)

A branch-per-field worker stops scaling around the third accessor. Replace it with a table keyed by field name carrying the type flag, and loop. This is the scaling win.

```ts
const ACCESSORS: Record<string, { sym: string; int?: boolean }> = {
  density:  { sym: "lib_get_density" },
  valence:  { sym: "lib_get_valence", int: true },
};

function readField(name: string, maxCount: number): number[] {
  const a = ACCESSORS[name];
  const buf = a.int ? new Int32Array(maxCount) : new Float64Array(maxCount);
  const n = lib.symbols[a.sym](ptr(buf), maxCount);
  return n > 0 ? Array.from(buf.subarray(0, n)) : [];
}
```

Adding a field is now one table row plus the C/FFI/type layers — no new worker branch.

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Branch per field | Obvious for 1–2 accessors | Copy-paste rot; easy to grab the wrong typed array |
| Dispatch table | Scales; `int?` flag kills the typed-array bug class | One indirection to read; needs the table kept in sync |
| Read C global directly | Less code in the binding | Garbage if the global lives in a build-excluded module |
| Recompute from primitives in binding | Correct under any build config | Duplicates a little C math |

## Edge Cases

- **Stale shared library.** Editing C without rebuilding (or with a test binary linking an old copy) yields `dyld: Symbol not found` at runtime. Rebuild, then confirm the worker/test loads the fresh artifact. Reconfigure the build if needed.
- **int vs double dispatch.** FFI buffers are typed. An `int` accessor needs `Int32Array`; a `double` accessor needs `Float64Array`. Mismatch reads silently wrong bytes. The `int?` flag in the dispatch table removes the per-field judgement call.
- **Index remapping.** C element ordinals can be sparse/gappy after deletions; the JS buffer is dense and sequential. Build an ordinal→position map once and reuse it so any indices returned to JS line up with the buffer row order. Factor it into a shared helper.
- **Build-config feature exclusion.** A headless/minimal build may exclude whole C modules (e.g. graphics). A global computed only in an excluded module still *links* (the `extern` compiles) but is never populated → zeros/garbage at runtime. Recompute the value from primitives in the binding instead of reading the global. Confirm the datum is produced by a module included in your build target.
- **negative vs zero return.** Distinguish `-1` (error) from `0` (valid but empty / not applicable). Let the UI omit a field gracefully on `0` rather than rendering an error.
- **One runnable check per accessor.** Add a tiny C test asserting `count == element_count` and values finite/in-range against a known fixture. Cheapest guard against a wiring or math bug.

## Related

- See `reference/examples.md` for a worked double + int accessor pair.
- Bun FFI docs: https://bun.sh/docs/api/ffi
