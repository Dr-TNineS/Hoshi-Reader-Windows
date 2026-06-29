# Configurable Keyboard Shortcuts Design

Date: 2026-06-29

## Goal

Make every current keyboard shortcut user-configurable while keeping existing mouse and pointer gestures fixed. The Shortcuts panel becomes the single editing surface for keyboard shortcuts, and the rendered bindings must match the actual Reader, Sasayaki, and global lookup behavior.

## Scope

Configurable keyboard actions:

- Global: look up selected text.
- Reader: next page, previous page, next chapter, previous chapter, clear selection or leave reader.
- Sasayaki: toggle playback, skip backward, skip forward.

Fixed non-keyboard gestures:

- Wheel up and wheel down page navigation.
- Ctrl or Meta plus wheel chapter navigation.
- Shift hover lookup.
- Left click lookup.

The fixed gestures remain visible in the Shortcuts panel as secondary bindings, but they are not editable in this slice.

## Architecture

Add a frontend shortcut settings module that owns local keyboard shortcut defaults, persistence, normalization, matching, conflict checks, and display labels. Global lookup keeps its existing Rust/Tauri registration flow because it must register an OS-wide accelerator. Reader and Sasayaki use the frontend settings module because they only dispatch inside the app window.

`src/lib/shortcuts.ts` should become the registry of visible shortcut actions. Each action should have an id, group, label, optional detail, default keyboard binding, optional fixed gesture bindings, and metadata describing whether it is editable. A separate settings object stores user overrides by action id. Missing or invalid overrides fall back to defaults.

## Data Model

Use the existing `ShortcutBinding` shape for frontend keyboard shortcuts:

```ts
type ShortcutBinding = {
  modifiers: string[];
  keyCode: string;
  displayLabel: string;
};
```

Persist frontend shortcut settings in browser `localStorage` under a versioned key such as `hoshi_keyboard_shortcuts`. The persisted shape should be:

```ts
type KeyboardShortcutSettings = {
  version: 1;
  bindings: Record<string, ShortcutBinding>;
};
```

Only Reader and Sasayaki action overrides live in this store. The global lookup binding remains in `globalLookupSettings` and is stored through the existing Tauri command path.

## Shortcut Recording

Replace the global-only shortcut editor with a generic keyboard shortcut editor that can record any editable action. Recording rules should match the current global recorder:

- Escape cancels recording.
- Backspace resets the current action to its default.
- A valid shortcut must include a supported non-modifier key.
- For app-local Reader and Sasayaki actions, shortcuts may be single-key or modifier combinations.
- For global lookup, keep the stricter current rule requiring Ctrl, Alt, or Win with a regular key.

The editor must not leave the app in a partial recording state after cancel, reset, or save.

## Conflict Rules

Within the app-local Reader and Sasayaki set, two editable keyboard actions must not share the same normalized binding. If the user records a binding already used by another local action, show an actionable error and keep the previous binding.

Global lookup conflicts are handled separately by the Tauri global shortcut registration result. It can share a display surface with the other shortcuts, but its registration error remains owned by `globalLookupSettings.registration`.

Fixed gestures do not participate in conflict checks.

## Dispatch

Reader receives the current keyboard shortcut settings and uses a shared matcher instead of hard-coded Arrow and Escape checks:

- Next page.
- Previous page.
- Next chapter.
- Previous chapter.
- Clear selection or leave reader.

Sasayaki receives the same settings and maps a matched action to toggle, previous, or next playback behavior. It must keep the existing guard that ignores editable targets such as inputs, selects, buttons, textareas, and contenteditable elements.

Reader Shift hover state can stay hard-coded because Shift hover remains a fixed gesture. The Shift key should not become an editable "lookup at pointer" action in this slice.

## UI

The Shortcuts panel shows every group as it does now, but editable keyboard actions render a compact binding editor with Record and Reset controls. Fixed gestures render as read-only keycap bindings beside or below the editable keyboard binding.

Advanced can keep showing global selected-text lookup controls for discoverability, but Shortcuts is the full editing surface. If an action is disabled or unavailable, its binding should still be visible and editable unless editing would be misleading.

## Error Handling

Invalid recording input shows the existing user-facing message style near the edited row. Conflict errors should name the conflicting action, for example: `Already used by Next page.`

Corrupt or unknown persisted settings fall back to defaults without breaking app startup. Unknown action ids in persisted settings are ignored when rendering or dispatching.

## Testing

Add focused unit coverage for shortcut normalization, local single-key validity, modifier combinations, conflict detection, matching, and corrupted persisted settings fallback.

Update frontend probes:

- `global-lookup-settings-check.mjs`: keep global recording coverage and verify the generic editor still supports global combinations.
- `bookshelf-check.mjs`: verify Shortcuts lists editable controls for Reader and Sasayaki keyboard actions.
- `reader-visual-check.mjs`: configure a non-default Reader binding in probe state and verify the new key performs the action while the old default no longer does.
- `sasayaki-playback-check.mjs`: configure non-default Sasayaki bindings and verify playback/skip dispatch while focused playback controls still ignore shortcuts.

Required final validation:

- `npm run check:global-lookup-settings`
- `npm run check:bookshelf`
- `npm run check:reader-visual`
- `npm run check:sasayaki-playback`
- `npm run check`
- `npm run build`
- `git diff --check`

## Non-Goals

- Do not make mouse wheel navigation configurable in this slice.
- Do not make Shift hover or left-click lookup configurable in this slice.
- Do not add OS-wide registration for Reader or Sasayaki shortcuts.
- Do not introduce profile-scoped shortcut settings.
- Do not change Reader pagination, lookup selection, or Sasayaki playback semantics beyond replacing the keyboard trigger matcher.
