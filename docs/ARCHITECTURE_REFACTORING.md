# HSW Architecture Refactoring

Last updated: 2026-06-29

This document tracks future architecture direction only. It is not a current
architecture overview, task log, handoff file, or completion ledger. Current
architecture lives in `docs/ARCHITECTURE.md`; current implementation status
lives in `docs/PROJECT_STATUS.md`.

`AGENTS.md` should contain only rules that every agent must keep in context.
This file owns longer-lived refactor targets that are too detailed or too
forward-looking for the always-loaded agent contract.

When a refactor target is completed and becomes the repository baseline, update
`docs/ARCHITECTURE.md` in the same change and remove or rewrite the completed
target here.

## Target 1: Reduce App-Level Domain Orchestration

Priority: high

`App.svelte` should stay focused on top-level application flow. Complex
reader, bookshelf, dictionary, Anki, audio, and settings behavior should move
behind feature controllers or state modules when a slice already touches that
area.

Target shape:

- Keep top-level shelf/reader switching and route-like wiring in `App.svelte`.
- Move feature data loading, mutation, and derived state behind narrow owners.
- Keep UI-only transient state near the component that renders it.
- Preserve existing behavior while moving one verifiable slice at a time.

Exit criteria:

- New feature work does not add long-lived cross-feature booleans to
  `App.svelte`.
- Feature components can be read as rendering and event wiring, not hidden
  storage or backend workflows.

## Target 2: Stabilize Shared Command And Error Shapes

Priority: high

Cross-layer features should use consistent TypeScript/Rust payloads and
actionable errors. Similar commands should not each invent their own path,
status, or error vocabulary.

Target shape:

- Keep Tauri commands narrow and validate arguments at the boundary.
- Share or mirror TypeScript/Rust model shapes deliberately.
- Return UI-safe status and error values instead of native exception strings.
- Keep local filesystem paths out of visible UI unless the user explicitly
  selected or must repair that path.

Exit criteria:

- New commands have documented payload ownership and tests or probes for visible
  states.
- Existing high-risk commands use consistent containment, fallback, and error
  semantics.

## Target 3: Clarify Durable Storage Schemas

Priority: medium

HSW currently uses JSON files for library, reading state, dictionary manifest,
Anki settings, and per-book sidecars. This is acceptable today, but schema
ownership and migration rules should become more explicit as data grows.

Target shape:

- Keep app-owned data writes behind Rust storage boundaries.
- Record versioning, legacy fallback, staged writes, and rollback behavior where
  a schema is changed.
- Consider a durable database only when a feature needs queryability,
  transactions, or migration guarantees that JSON files no longer provide.

Exit criteria:

- Storage shape changes document compatibility and failure behavior.
- UI components do not write manifest or sidecar data directly.

## Target 4: Keep Reader Changes Slice-Based

Priority: high

Reader layout, selection, lookup, TOC, progress, image reflow, and Sasayaki
presentation are tightly coupled in user-visible behavior. Refactors should
avoid replacing the pagination model unless a dedicated plan and validation
matrix exist.

Target shape:

- Preserve the current CSS-column pagination model during ordinary fixes.
- Separate state ownership before broad reader rewrites.
- Use focused probes and Tauri visual checks for layout-affecting changes.
- Keep HSA-visible behavior as the reference when reader behavior is being
  aligned, while adapting implementation to Windows/Tauri constraints.

Exit criteria:

- Reader fixes remain small, reproducible, and covered by the matching probe.
- Larger reader architecture changes have a feature plan before implementation.
