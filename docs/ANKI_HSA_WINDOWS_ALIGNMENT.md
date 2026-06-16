# Anki HSA / Windows Alignment

Last updated: 2026-06-17

This document evaluates how Hoshi Reader Windows (HSW) should move from the
current disabled lookup-to-Anki payload boundary toward a Windows-native Anki
integration.

Implementation status as of 2026-06-17: Slice 1 readiness/configuration is
implemented. Card creation, duplicate checks, field mapping, settings beyond the
minimal Anki panel, and media export are still not implemented.

Do not modify `reference/`, `third_party/hoshidicts`, HSA, Anki, or Yomitan
from this document.

## Current HSW State

- Lookup popup results can build a typed `LookupAnkiPayload` with selected text,
  expression, reading, glossary entries, dictionary label, match/deinflection
  data, source book locator, and source chapter.
- The popup exposes only a disabled `Anki not configured` affordance. It does
  not call any backend and does not pretend card creation is available.
- HSW has a minimal Windows AnkiConnect readiness/configuration path:
  - Rust/Tauri commands load/save `anki/settings.json` under app data.
  - `anki_ping` checks a localhost AnkiConnect endpoint without throwing UI
    errors for normal connection failure.
  - `anki_fetch_config` fetches deck names, note types, and note fields through
    AnkiConnect v6 and persists selected deck/note type.
  - The bookshelf Anki panel can edit endpoint, test connection, fetch config,
    and select deck/note type.
- There is no field mapping UI, duplicate check, card creation, sync, or Anki
  media export.
- Existing lookup popup probes cover that the disabled Anki boundary remains
  visible/click-safe and cannot be styled away by dictionary CSS.

## HSA Reference Findings

HSA has a full Anki subsystem with clear layers:

- `AnkiSettings` stores backend kind, selected deck/note type, fetched decks and
  note types, field mappings, tags, duplicate policy, compact glossary mode,
  media embedding, AnkiConnect URL, and force-sync flags.
- `AnkiBackend` abstracts AnkiDroid and AnkiConnect behind common operations:
  availability, deck/note-type fetch, duplicate check, add note, media upload,
  and sync.
- `AnkiConnectBackend` talks to AnkiConnect v6 over HTTP and uses `deckNames`,
  `modelNames`, `modelFieldNames`, `canAddNotesWithErrorDetail`, `addNote`,
  `storeMediaFile`, and `sync`.
- `AnkiRepository` owns settings, active backend selection, fetch/ping logic,
  field rendering, duplicate checks, note creation, and optional media/audio
  preparation.
- Popup documents send `mineEntry` and `duplicateCheck` bridge messages; native
  code handles backend work and replies to the popup.
- `AnkiFieldTemplates` provides defaults for known note models such as Lapis,
  Kiku, and Senren, using handlebars like `{expression}`, `{reading}`,
  `{glossary-first}`, `{sentence}`, `{frequencies}`, and `{pitch-accent-positions}`.

Android-specific pieces that should not be copied directly to HSW:

- AnkiDroid provider access, Android runtime permissions, Android `FileProvider`,
  Android Settings screens, and AnkiDroid direct database/provider APIs.
- Sasayaki sentence audio and local Android audio flows.
- Android popup iframe bridge mechanics. HSW already owns Svelte DOM popups and
  can call Tauri commands directly.

## Windows Recommendation

HSW should implement Anki in small Windows-first slices using desktop
AnkiConnect as the first backend.

- Default endpoint: `http://127.0.0.1:8765`.
- Keep Anki state in Tauri app data JSON, not browser `localStorage`.
- Keep popup controls disabled until endpoint, deck, note type, and field
  mappings are configured.
- Build from the existing `LookupAnkiPayload`; do not replace lookup result or
  popup stack logic.
- Defer media/audio export until plain text card creation, duplicate handling,
  and field rendering are stable.

## Follow-Up Implementation Slices

### Slice 1: AnkiConnect Readiness And Configuration

Goal: add Windows AnkiConnect configuration and status without creating cards.

Status: implemented on 2026-06-17.

Key changes:

- Add Rust/Tauri commands for Anki settings load/save, endpoint ping, and deck /
  note-type fetch.
- Store endpoint, selected deck, selected note type, fetched deck/note-type
  lists, and field mappings in app data JSON.
- Add a minimal bookshelf settings panel or Anki panel entry for endpoint,
  `Test Connection`, `Fetch`, deck selection, and note-type selection.
- Keep lookup popup Anki action disabled unless configuration is complete.

Acceptance:

- With Anki + AnkiConnect running, HSW can ping, fetch decks, fetch note types,
  and persist selections across restart.
- With AnkiConnect unavailable, UI shows a clear actionable error.
- No `addNote` or duplicate check is called.

Validation:

- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`
- `npm run check`
- `npm run build`
- `npm run check:anki-connect`
- Manual AnkiConnect ping/fetch with desktop Anki open.

### Slice 2: Field Mapping And Preview

Goal: turn `LookupAnkiPayload` into previewable note fields without sending
cards to Anki.

Key changes:

- Add a frontend/Rust shared field-rendering shape for selected note type fields
  and templates.
- Support a small initial handlebar set: `{expression}`, `{reading}`,
  `{popup-selection-text}`, `{glossary-first}`, `{glossary}`, `{sentence}`,
  `{document-title}`, `{frequencies}`, and `{pitch-accent-positions}`.
- Provide default mappings for Lapis/Kiku/Senren where fields match HSA names.
- Add a preview action from lookup popup or Anki panel using the current
  `LookupAnkiPayload`.

Acceptance:

- Users can see exactly what fields would be sent for a selected lookup result.
- Unknown handlebars render empty rather than crashing.
- No card is created.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`

### Slice 3: Duplicate Check And Minimal Add Note

Goal: create a basic vocabulary card through AnkiConnect.

Key changes:

- Add Rust/Tauri commands for duplicate check and `addNote`.
- Use AnkiConnect v6 `canAddNotesWithErrorDetail` before `addNote` unless
  `allowDupes` is enabled.
- Send rendered field values, selected deck, selected model, and optional tags.
- Update popup Anki button from disabled to configured/adding/added/duplicate/error states.

Acceptance:

- A configured AnkiConnect setup can create one note from a lookup result.
- Duplicate cards are detected and surfaced without crashing the popup.
- Missing deck/model/field configuration keeps the action disabled.

Validation:

- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`
- `npm run check`
- `npm run build`
- Manual add-note and duplicate-check flow with a throwaway Anki deck.

### Slice 4: Media, Audio, And Sync Follow-Up

Goal: evaluate richer HSA parity only after text card creation is stable.

Deferred items:

- Dictionary media export through AnkiConnect `storeMediaFile`.
- Word audio and local audio export.
- Sasayaki sentence audio.
- Optional AnkiConnect `sync`.
- Advanced duplicate scopes and all-model duplicate behavior.

Acceptance:

- This slice should start only after Slice 3 has stable manual and automated
  coverage.

## Assumptions

- Desktop Windows Anki integration should prioritize AnkiConnect over direct
  Anki profile/database access.
- The first usable HSW card creation path should be text-first and reader-flow
  oriented.
- Settings UI should stay minimal until card creation proves useful.
- Existing dictionary popup stack, Shift-hover behavior, redirect history, and
  dictionary media loading should not be refactored for Anki.
