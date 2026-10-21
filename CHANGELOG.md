# Changelog

How the app got to where it is, stage by stage, summarised from the git
history. There are no version numbers: every push to `main` that passes CI
becomes the rolling [`latest`](../../releases/tag/latest) build. For a single
change, see `git log`.

## Feb–Mar 2026 — Taming the engine

- Imported Ken Brakke's Surface Evolver sources, manual and examples, and
  dropped the VNC Docker setup in favour of running against a host X server.
- Wrote the `se_api` C facade, the one place that knows both the engine's
  internals and what an FFI caller needs, and stripped unused code from the
  vendored engine.
- Added a CMake build, C and Python API tests, a Python `ctypes` wrapper, and
  CI. Wrote the first system-design notes and a call-graph analysis tool.

## Mar–Apr 2026 — A web app

- Built a FastAPI backend and a React + Three.js frontend, both in Docker,
  with the engine in a worker subprocess and rate limiting in front of it.
- Restyled the UI with Tailwind and served the Surface Evolver manual from the
  frontend.
- Tried a Docusaurus docs site and removed it the same day, then moved
  everything under `app/`.

## Jun 2026 — Bun backend

- Replaced the FastAPI backend with Bun/TypeScript, dropping the Python
  bindings and tests along with it.

## Late Jun – early Jul 2026 — Electrobun desktop app

- Ported the app to an Electrobun desktop shell. The web server and the
  async-iterate machinery became dead code and were deleted.
- Grew the C facade substantially: edges, bounding box, topology counters,
  named quantities, per-element colours, normals and user attributes.
- New viewer features: edge rendering, colormaps, an "SE colours" render mode,
  click-to-pick vertices, body centre-of-mass markers, and light/dark themes
  that follow the OS.
- A native macOS menu bar drives the whole app. Session persistence and a
  file-browser modal arrived, and user `.fe` files shadow bundled ones.
- Fixed scrambled geometry on 2-D and 4-D datafiles by always passing vertices
  three coordinates wide, and stopped interactive commands from hanging the
  worker.
- Added the "SE" app icon and a release workflow producing macOS and Linux
  archives. Windows was dropped at this stage.

## Jul 2026 — Tauri v2

- Ported the desktop app from Electrobun to Tauri v2 with a Rust backend
  behind a single `rpc` command, and flattened the repository layout.
- Brought Windows back (the engine built with MinGW). Linux ships as a `.deb`
  after AppImage packaging failed on the bun sidecar.
- Cleaned up dead code and fixed CI for the new layout.

## Late Jul – mid Aug 2026 — Hardening and narrowing

- Fixed a session-restore race, broken state after a failed load, and
  persistence blocking the command path.
- Audited the foam/cellular models against the professor's use case, with
  measured findings.
- Ported the worker sidecar from bun:ffi to Rust: 58 MB down to 345 KB. Added
  an FFI signature guard and smoke tests, and fixed a build step that would
  have broken on Windows.
- Narrowed the app to what it can draw honestly. Periodic surfaces hide their
  wrapped edges. STRING and SIMPLEX datafiles are rejected at load, and the
  bundle went from 115 files to 21, all of which load. The physics and
  named-quantity panels went too, since the command line covers them. The C
  facade shrank from 49 exports to 28.
- Recorded an architecture assessment and started this changelog.

## Late Aug – Sep 2026 — Documentation and tests

- Rewrote the README, added `AGENTS.md` as the canonical guide for coding
  agents, and documented the C facade's contract.
- Filled the testing gaps: a fixture test that loads and meshes every bundled
  file, app-layer integration tests driving a real worker, and a 47-test
  Vitest suite for the frontend.
- Fixed `crystal.fe` failing on Linux (a case mismatch in its `OCTA.WLF`
  reference) and folded the backlog into `ARCHITECTURE.md`.

## Oct 2026 — Audit and cleanup

- Audited the whole codebase and filed every confirmed bug as a GitHub issue
  on a project board.
- Cleaned up the git history: accurate commit messages, split commits that hid
  changes, and purged committed build output (90 MB → 8 MB clone).
- Retired version tags. Releases are now a rolling `latest` build that is
  published only after CI passes on `main`.
- Gave the app a neutral theme matching the project site. This fixed viewer
  colours that came out white in Chromium-based webviews (Windows), and
  replaced the sidebar icon with the standard solid one.
- Brought the README, `AGENTS.md`, `ARCHITECTURE.md` and code comments back in
  line with the code.
