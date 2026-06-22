# Dictionary Popup Desktop Alignment Plan

Last updated: 2026-06-23

## Goal

Align the Hoshi Reader Windows dictionary popup sizing and typography with the
current Hoshi Reader upstream popup while keeping the existing Svelte popup
stack, Windows-first placement, and dictionary rendering boundaries.

The upstream reference at commit `f09664d` uses a configurable popup frame,
defaults to `320 x 250`, and exposes width, height, and content scale controls.
Its popup content uses a Japanese sans-serif font, a 26 px expression, 13 px
reading, 15 px glossary text, and smaller 10-13 px metadata tiers at scale 1.

## Scope and Decisions

- Default popup frame: `320 x 250` CSS pixels.
- Width setting: `100...700`, step `10`.
- Height setting: `100...800`, step `10`.
- Content scale: `0.8...1.5`, step `0.05`, default `1.0`.
- Font stack: `"Yu Gothic UI", "Meiryo", "Segoe UI", sans-serif`.
- Configured width and height describe the outer border box and are not
  multiplied by content scale.
- When the reader viewport is smaller than the configured frame, the rendered
  frame shrinks to stay inside the existing popup margins without changing the
  persisted setting.
- Long results scroll inside the fixed frame. Loading, empty, and error states
  use the same frame.
- Root and child popups share one setting and keep the current side-first,
  top/bottom-fallback placement behavior.

Out of scope: transparency, colors, full-width mode, custom popup CSS, font
selection, popup renderer replacement, pagination changes, and Rust commands.

## Slice Route

| Slice | Status | Deliverable | Validation | Commit |
| --- | --- | --- | --- | --- |
| 0 | Complete | Plan and short handoff | `git diff --check` passed | this documentation commit |
| 1 | Complete | Persisted width/height/scale settings, Appearance controls, responsive fixed frame, internal scrolling | settings, bookshelf, and popup probes passed; `npm run check` and `npm run build` passed | this feature commit |
| 2 | Complete | Windows Japanese sans typography, scaled popup content, final visual coverage and status docs | popup and settings probes passed; `npm run check` and `npm run build` passed; wide/narrow/default/0.8/1.5/nested visual checks passed | this feature commit |

After each slice, update this table with the commit and validation result, then
reassess the next slice before editing implementation files.

## Acceptance Criteria

### Sizing and settings

- Missing or invalid persisted settings load as `320 x 250` at scale `1.0`.
- Stored values are finite, clamped to the supported range, and snapped to the
  documented step.
- Appearance controls update and persist each setting immediately.
- At `1280 x 720`, the default popup outer frame measures `320 x 250`.
- Maximum settings remain inside the reader viewport and do not overwrite the
  configured values when temporarily constrained.
- At `360 x 640`, the popup creates no horizontal viewport overflow.
- Long results, bottom-edge placement, nested popups, redirect history, media,
  and tables continue to work inside the constrained frame.

### Typography and scale

- At scale `1.0`, expression/reading/glossary sizes are `26/13/15` px, glossary
  line height is `1.4`, metadata tiers remain within `10...14` px, and pitch
  information is `13` px.
- Content scale affects popup result typography, spacing, tags, result-level
  audio/Anki buttons, and dictionary media height.
- Content scale does not change the popup outer frame or the desktop
  Lookup/history/close bar.
- Scoped dictionary CSS, structured content, ruby, tables, media, and lookup
  selection remain functional.

## Validation Commands

- `npm run check:settings-state`
- `npm run check:lookup-popup`
- `npm run check`
- `npm run build`
- Runtime visual checks at wide and narrow window sizes for normal, long,
  bottom-edge, nested, media/table, scale `0.8`, and scale `1.5` cases.
