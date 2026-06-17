# Anki Media Export Plan

Last updated: 2026-06-18

This document defines the first Anki media/export scope after text card creation
was validated against desktop AnkiConnect.

Implementation status as of 2026-06-18: Slice 4A media reference extraction and
`{dictionary-media}` preview are implemented. Slice 4B Rust `storeMediaFile`
support is implemented and passed real AnkiConnect runtime validation. Add-note
integration is not implemented.

## Current Baseline

- HSW can create text Anki notes through desktop AnkiConnect.
- Runtime validation passed on 2026-06-18 with AnkiConnect v6 on
  `127.0.0.1:8765`: a throwaway deck/model was created, one note was added
  through HSW `anki_add_note`, a second add was blocked as a duplicate, and
  cleanup was attempted.
- Lookup popup already renders dictionary image placeholders from structured
  glossary content and lazily loads them through the read-only
  `dictionary_media(dictionary, path)` command.
- `LookupAnkiPayload` currently contains glossary text, frequencies, pitch data,
  source book/chapter context, and extracted dictionary media references.
- Compatibility dictionary imports that hit legacy filename encoding issues may
  skip media and import with `mediaCount=0`. That limitation should remain
  visible and non-fatal.

## First Scope Decision

First Anki media scope: dictionary image media export only.

Included:

- Image references already present in lookup structured glossary content.
- Existing imported dictionary media served by `dictionary_media`.
- Desktop AnkiConnect `storeMediaFile`.
- Field template token for exported media, recommended as `{dictionary-media}`.
- Text-card behavior remains usable when media is missing.

Excluded:

- Word audio, local audio, pronunciation downloads, and Sasayaki sentence audio.
- AnkiConnect `sync`.
- Dictionary import compatibility recovery for legacy/non-ASCII media filenames.
- Arbitrary file export from frontend paths.
- Full HSA media/audio settings surface.

Reasoning:

- Dictionary image media is already represented in the popup renderer and backed
  by a safe Rust media command.
- It is the smallest media path that exercises `storeMediaFile` without adding
  capture/download/audio systems.
- It can degrade cleanly: if media is missing, card creation should continue with
  text fields and a visible warning.

## Proposed Data Flow

1. Extract dictionary media references from lookup glossary structured content.
2. Deduplicate by dictionary id/title plus media path.
3. Ask Rust to resolve and read each media file using the same safety rules as
   `dictionary_media`.
4. Store each file through AnkiConnect `storeMediaFile` with a deterministic
   filename, such as `hsw_<hash>.<ext>`.
5. Add rendered HTML snippets to Anki field rendering through
   `{dictionary-media}`.
6. Call duplicate check and `addNote` using the existing `anki_add_note` path.

The Rust side should keep path handling locked to imported dictionary roots; the
frontend should not pass arbitrary filesystem paths.

## Implementation Slices

### Slice 4A: Media Reference Extraction And Preview

Goal: make dictionary media references visible to Anki field rendering without
calling `storeMediaFile`.

Status: implemented on 2026-06-18.

Key changes:

- Add a structured media reference shape to `LookupAnkiPayload`.
- Extract image references from structured glossary entries during payload
  construction.
- Add `{dictionary-media}` field rendering that previews deterministic HTML
  placeholders such as `<img src="...">` using mocked/staged filenames.
- Extend lookup popup probe to verify multiple references dedupe and missing
  media stays non-fatal.

Acceptance:

- A lookup result with structured image content produces media references in the
  Anki payload.
- `{dictionary-media}` preview renders stable HTML.
- Existing text-only notes and unconfigured Anki states are unchanged.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`

### Slice 4B: Rust Store-Media Command

Goal: store imported dictionary image media in Anki without creating notes.

Status: implemented on 2026-06-18; real AnkiConnect runtime validation passed.

Key changes:

- Add a Rust command that accepts dictionary media refs, resolves them under the
  imported dictionary root, reads bytes, and calls AnkiConnect `storeMediaFile`.
- Use deterministic filenames and return stored filenames plus warnings.
- Reuse practical image mime/extension handling from dictionary media loading.
- Add Rust tests for path escape, missing media, deterministic filename, and
  AnkiConnect response parsing.
- Add an ignored real AnkiConnect runtime test for `storeMediaFile`.

Acceptance:

- Valid imported dictionary images are stored in Anki media collection.
- Missing media returns warnings, not a hard card-creation failure.
- Path escape and unsupported file types remain blocked.

Validation:

- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`
- Ignored real AnkiConnect store-media validation with a throwaway filename.

### Slice 4C: Add-Note Integration

Goal: include stored dictionary media in notes created from lookup popup.

Status: next recommended implementation slice.

Key changes:

- Extend the add-note flow to store media before duplicate check/addNote.
- Replace `{dictionary-media}` preview placeholders with actual Anki media
  filenames returned by Rust.
- Show non-fatal warnings in popup when some media cannot be stored.
- Keep duplicate handling unchanged.

Acceptance:

- A configured note can include dictionary image HTML in the selected field.
- Duplicate note behavior still prevents second `addNote`.
- Missing media does not prevent text card creation.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`
- Real AnkiConnect runtime validation with a throwaway deck/model and a small
  image-bearing fixture.

## Open Questions

- Real media-bearing Yomitan dictionary runtime validation is still blocked
  until a suitable local dictionary zip is available.
- If the first real dictionary exposes image shapes not covered by current
  structured content parsing, extend the parser minimally in Slice 4A.
- Audio should wait until dictionary image export and text note stability are
  both verified.
