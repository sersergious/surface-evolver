# bun-ffi-c-binding

Adding one data accessor to a C library that a TypeScript/Bun frontend reads through `bun:ffi` requires coordinated edits at eight layers — C function, C header, the compiled shared library, the FFI symbol map, the worker handler, the IPC/RPC passthrough, the frontend type, and the UI. This skill captures that layered checklist plus the non-obvious failure modes (runtime `dyld: Symbol not found` from a stale lib, int/double typed-array mismatch, sparse-ordinal index remapping, and globals that link but never populate under a minimal build config).

## When to use it

Reach for this when you are exposing a new field or accessor from a C lib wrapped via `bun:ffi`, particularly when the C lib lives in a worker subprocess and data flows up through an IPC/RPC layer to a UI. It is most valuable once you have more than two accessors, where the dispatch-table generalization pays off.

## Installation

Copy the `bun-ffi-c-binding/` directory into your skills directory. `SKILL.md` is the entry point; `reference/examples.md` has a concrete worked pair.

## Source

Extracted from a pattern proven nine times while wiring engine accessors through a `bun:ffi` worker to a React frontend.
