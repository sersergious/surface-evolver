# CLAUDE.md

**See [`AGENTS.md`](../AGENTS.md) in the repository root.**

That file is the canonical guidance for this codebase and is vendor-neutral, so
every agent reads the same thing. It covers setup, the verification gates,
architecture, and — most importantly — eleven documented landmines that will
otherwise cost you time (one-worker-per-session, the vendored engine, the
non-workspace sidecar crate, FFI lockstep, stride-3 mesh buffers, and more).

This file exists only so Claude Code finds the pointer. Nothing project-specific
lives here: duplicating it would guarantee the two copies drift, which this
repository has already been bitten by more than once.
