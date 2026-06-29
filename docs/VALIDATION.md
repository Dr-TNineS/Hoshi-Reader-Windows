# HSW Validation Guide

This file contains durable validation policy for Hoshi Reader Windows. Update it
only when validation requirements, probe names, test data, or stable manual QA
flows change.

## Required Commands

Documentation-only changes:

```text
git diff --check
```

Frontend, Svelte, TypeScript, or shared type changes:

```text
npm run check
```

User-visible frontend changes or release-facing frontend delivery:

```text
npm run build
```

Rust command, EPUB, library/storage, dictionary backend, Anki backend,
sanitizer, audio, or native bridge changes:

```text
cd src-tauri
cargo check
```

Run Rust tests when touching storage, EPUB parsing, CSS sanitization,
dictionary logic, Anki backend logic, audio/Sasayaki logic, or other code with
relevant existing tests:

```text
cd src-tauri
cargo test --lib
```

## Focused Probes

When changing behavior covered by a focused probe, run the matching script in
addition to the general checks. `npm run check` and `npm run build` do not
replace these behavior probes.

- AnkiConnect panel: `npm run check:anki-connect`
- Bookshelf shell, import, and confirmation flows: `npm run check:bookshelf`
- Dictionary management: `npm run check:dictionary-management`
- Dictionary search: `npm run check:dictionary-search`
- Appearance and Advanced settings state: `npm run check:settings-state`
- Lookup popup: `npm run check:lookup-popup`
- Lookup cache/performance behavior: `npm run check:lookup-performance`
- Reader TOC: `npm run check:reader-toc`
- Reader layout, selection, navigation, and visual behavior: `npm run check:reader-visual`
- Sasayaki playback coordination: `npm run check:sasayaki-playback`

## Linked Dictionary Validation

The hoshidicts linked backend needs a VS x64 developer environment or
equivalent MSVC, CMake, and Ninja setup. Prefer the repository wrapper so the
validation runs from the current worktree and derives `HSW_HOSHIDICTS_DIR`
without hardcoded checkout paths:

```text
npm run check:tauri-linked
npm run test:dict-linked
```

For a narrower linked Rust command, run:

```text
scripts\vs-x64-cargo.cmd test --lib <test-filter>
```

Do not switch to a hardcoded main checkout path just to make linked validation
pass.

In PowerShell, do not wrap a `cmd /c "call C:\Program Files (x86)\..."`
developer-shell command with outer double quotes; `(x86)` can be parsed
incorrectly. Prefer `scripts\vs-x64-cargo.cmd`. If a handwritten `cmd /c` call
is unavoidable, wrap the whole command in outer single quotes.

## Runtime Validation

Use runtime validation only when the local dependency and test data are actually
available. If not, record the result as `not verified`.

- Real desktop Anki add-note validation: from `src-tauri`, set
  `HSW_ANKI_RUNTIME_VALIDATE=1`, then run
  `cargo test --lib validates_real_ankiconnect_add_note_and_duplicate_check -- --ignored --nocapture`.
- Real desktop Anki store-media validation: from `src-tauri`, set
  `HSW_ANKI_RUNTIME_VALIDATE=1`, then run
  `cargo test --lib validates_real_ankiconnect_store_dictionary_media -- --ignored --nocapture`.
- Linked real dictionary validation: use a VS developer shell or
  `scripts\vs-x64-cargo.cmd`, set `RUSTFLAGS=--cfg hoshi_dicts_linked`,
  `CARGO_TARGET_DIR=target-linked-check`, and
  `HSW_REAL_YOMITAN_ZIP=<local dictionary zip>`, then run
  `cargo test --lib imports_real_yomitan_zip_and_loads_runtime -- --ignored --nocapture`.
- Tauri runtime visual checks: use `cmd /c npx.cmd tauri dev` when a real Tauri
  WebView or native command path must be observed.

Reader layout, selection, popup placement, TOC, focus, keyboard, image reflow,
or progress-restore changes require the relevant probe plus a Tauri runtime
visual check when the behavior cannot be fully verified in the probe.

## Packaging

`npm run package` is a packaging validation, not a default check. Run it only
when the user requests packaging, a task affects packaging/release output, or a
feature plan explicitly requires package validation.
