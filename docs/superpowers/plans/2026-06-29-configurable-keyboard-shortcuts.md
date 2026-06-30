# Configurable Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every current keyboard shortcut editable while keeping mouse wheel, Shift-hover, and click lookup gestures fixed.

**Architecture:** Add a frontend keyboard shortcut settings module for app-local Reader and Sasayaki actions, while leaving global lookup on its existing Tauri registration path. Shortcuts rendering will consume one registry so displayed bindings, recorder controls, conflict validation, and dispatch all use the same normalized bindings.

**Tech Stack:** Svelte 5, TypeScript, Vite SSR for unit-style script checks, Playwright probes, browser `localStorage`, existing Tauri global lookup commands.

---

## File Structure

- Create `src/lib/keyboard-shortcuts.ts`: app-local keyboard shortcut ids, defaults, normalization, persistence, matching, conflict detection, and capture helpers.
- Modify `src/lib/state/settings.svelte.ts`: load/save keyboard shortcut settings and expose update/reset methods.
- Modify `src/lib/shortcuts.ts`: produce visible shortcut groups from global settings plus app-local settings.
- Modify `src/lib/GlobalShortcutEditor.svelte`: make the recorder support both global and app-local validation modes.
- Modify `src/lib/ShortcutsPanel.svelte`: render an editor for every editable keyboard action, read-only bindings for fixed gestures, and row-scoped conflict errors.
- Modify `src/lib/AdvancedPanel.svelte`: keep global lookup editing through the generic recorder in global mode.
- Modify `src/lib/BookshelfView.svelte`, `src/lib/BookshelfProbe.svelte`, `src/lib/DictionarySearchProbe.svelte`, and `src/App.svelte`: pass shortcut settings and update/reset handlers.
- Modify `src/lib/reader/Reader.svelte` and `src/lib/reader/ReaderVisualProbe.svelte`: dispatch Reader key actions from settings.
- Modify `src/lib/sasayaki-shortcuts.ts` and `src/lib/SasayakiPlaybackProbe.svelte`: dispatch Sasayaki key actions from settings.
- Modify `scripts/keyboard-shortcuts-unit-check.mjs`: Vite SSR unit-style assertions for shortcut normalization, matching, persistence fallback, and conflicts.
- Modify `scripts/global-lookup-settings-check.mjs`, `scripts/bookshelf-check.mjs`, `scripts/reader-visual-check.mjs`, and `scripts/sasayaki-playback-check.mjs`: probe the configurable flows.
- Modify `package.json`: add `check:keyboard-shortcuts`.
- Modify `README.md` and `docs/PROJECT_STATUS.md`: update implementation facts after behavior changes.

### Task 1: App-Local Shortcut Model

**Files:**
- Create: `src/lib/keyboard-shortcuts.ts`
- Create: `scripts/keyboard-shortcuts-unit-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing unit-style check**

Create `scripts/keyboard-shortcuts-unit-check.mjs`:

```js
import { createServer } from "vite";

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

function keyboardEvent(init) {
  return {
    code: init.code,
    key: init.key ?? "",
    ctrlKey: Boolean(init.ctrlKey),
    altKey: Boolean(init.altKey),
    shiftKey: Boolean(init.shiftKey),
    metaKey: Boolean(init.metaKey),
  };
}

const server = await createServer({ server: { middlewareMode: true } });
try {
  const shortcuts = await server.ssrLoadModule("/src/lib/keyboard-shortcuts.ts");

  assert(shortcuts.defaultKeyboardShortcutBindings["reader-next-page"].displayLabel === "Left", "Reader next page default should be Left.");
  assert(shortcuts.defaultKeyboardShortcutBindings["reader-previous-page"].displayLabel === "Right", "Reader previous page default should be Right.");
  assert(shortcuts.defaultKeyboardShortcutBindings["reader-next-chapter"].displayLabel === "Ctrl + Left", "Reader next chapter default should be Ctrl + Left.");
  assert(shortcuts.defaultKeyboardShortcutBindings["reader-previous-chapter"].displayLabel === "Ctrl + Right", "Reader previous chapter default should be Ctrl + Right.");
  assert(shortcuts.defaultKeyboardShortcutBindings["reader-close"].displayLabel === "Esc", "Reader close default should be Esc.");

  const single = shortcuts.normalizeLocalShortcutBinding({ modifiers: [], keyCode: "KeyN", displayLabel: "" });
  assert(single?.displayLabel === "N", "Local shortcuts should allow single regular keys.", single);

  const combo = shortcuts.normalizeLocalShortcutBinding({ modifiers: ["Shift", "Ctrl"], keyCode: "KeyK", displayLabel: "" });
  assert(combo?.displayLabel === "Ctrl + Shift + K", "Local shortcuts should normalize modifier order.", combo);

  assert(shortcuts.normalizeLocalShortcutBinding({ modifiers: [], keyCode: "Backspace", displayLabel: "" }) === null, "Backspace remains reserved for recorder reset.");
  assert(shortcuts.shortcutMatchesEvent(combo, keyboardEvent({ code: "KeyK", ctrlKey: true, shiftKey: true })), "Matcher should accept matching modifiers and key.");
  assert(!shortcuts.shortcutMatchesEvent(combo, keyboardEvent({ code: "KeyK", ctrlKey: true })), "Matcher should reject missing modifiers.");

  const captured = shortcuts.shortcutFromKeyboardEvent(keyboardEvent({ code: "KeyN", key: "n" }), { requireCommandModifier: false });
  assert(captured.status === "captured" && captured.shortcut.displayLabel === "N", "Recorder should capture app-local single-key shortcuts.", captured);

  const globalInvalid = shortcuts.shortcutFromKeyboardEvent(keyboardEvent({ code: "KeyN", key: "n" }), { requireCommandModifier: true });
  assert(globalInvalid.status === "invalid", "Global recorder should still require Ctrl, Alt, or Win.", globalInvalid);

  const conflict = shortcuts.conflictingKeyboardShortcutAction(
    {
      version: 1,
      bindings: {
        "reader-next-page": { modifiers: [], keyCode: "KeyN", displayLabel: "N" },
      },
    },
    "reader-previous-page",
    { modifiers: [], keyCode: "KeyN", displayLabel: "N" },
  );
  assert(conflict === "reader-next-page", "Conflict detector should name the existing local action.", { conflict });

  const normalized = shortcuts.normalizeKeyboardShortcutSettings({
    version: 99,
    bindings: {
      "reader-next-page": { modifiers: ["Alt"], keyCode: "KeyJ", displayLabel: "ignored" },
      stale: { modifiers: [], keyCode: "KeyQ", displayLabel: "Q" },
      "reader-previous-page": { modifiers: [], keyCode: "Backspace", displayLabel: "Backspace" },
    },
  });
  assert(normalized.version === 1, "Settings should normalize version.");
  assert(normalized.bindings["reader-next-page"].displayLabel === "Alt + J", "Valid persisted bindings should normalize labels.", normalized);
  assert(!("stale" in normalized.bindings), "Unknown persisted action ids should be ignored.", normalized);
  assert(!("reader-previous-page" in normalized.bindings), "Invalid persisted bindings should fall back to defaults.", normalized);
} finally {
  await server.close();
}
```

- [ ] **Step 2: Add the package script and run the red check**

Modify `package.json` scripts:

```json
"check:keyboard-shortcuts": "node scripts/keyboard-shortcuts-unit-check.mjs"
```

Run:

```text
npm run check:keyboard-shortcuts
```

Expected: FAIL because `/src/lib/keyboard-shortcuts.ts` does not exist.

- [ ] **Step 3: Implement the shortcut model**

Create `src/lib/keyboard-shortcuts.ts` with these exported APIs:

```ts
import type { ShortcutBinding } from "./global-lookup-settings";

export const keyboardShortcutActionIds = [
  "reader-next-page",
  "reader-previous-page",
  "reader-next-chapter",
  "reader-previous-chapter",
  "reader-close",
  "sasayaki-toggle-playback",
  "sasayaki-previous-skip-action",
  "sasayaki-next-skip-action",
] as const;

export type KeyboardShortcutActionId = typeof keyboardShortcutActionIds[number];

export type KeyboardShortcutSettings = {
  version: 1;
  bindings: Partial<Record<KeyboardShortcutActionId, ShortcutBinding>>;
};

export type ShortcutCaptureResult =
  | { status: "captured"; shortcut: ShortcutBinding }
  | { status: "cancel" }
  | { status: "reset" }
  | { status: "invalid"; message: string };

export const KEYBOARD_SHORTCUT_SETTINGS_KEY = "hoshi_keyboard_shortcuts";

const modifierOrder = ["Ctrl", "Alt", "Shift", "Win"] as const;
const actionIdSet = new Set<string>(keyboardShortcutActionIds);

export const defaultKeyboardShortcutBindings: Record<KeyboardShortcutActionId, ShortcutBinding> = {
  "reader-next-page": { modifiers: [], keyCode: "ArrowLeft", displayLabel: "Left" },
  "reader-previous-page": { modifiers: [], keyCode: "ArrowRight", displayLabel: "Right" },
  "reader-next-chapter": { modifiers: ["Ctrl"], keyCode: "ArrowLeft", displayLabel: "Ctrl + Left" },
  "reader-previous-chapter": { modifiers: ["Ctrl"], keyCode: "ArrowRight", displayLabel: "Ctrl + Right" },
  "reader-close": { modifiers: [], keyCode: "Escape", displayLabel: "Esc" },
  "sasayaki-toggle-playback": { modifiers: [], keyCode: "KeyP", displayLabel: "P" },
  "sasayaki-previous-skip-action": { modifiers: [], keyCode: "BracketLeft", displayLabel: "[" },
  "sasayaki-next-skip-action": { modifiers: [], keyCode: "BracketRight", displayLabel: "]" },
};

export const defaultKeyboardShortcutSettings: KeyboardShortcutSettings = {
  version: 1,
  bindings: {},
};

function normalizedModifier(modifier: string): typeof modifierOrder[number] | null {
  const value = modifier.trim().toLowerCase();
  if (value === "ctrl" || value === "control") return "Ctrl";
  if (value === "alt" || value === "option") return "Alt";
  if (value === "shift") return "Shift";
  if (value === "win" || value === "meta" || value === "super" || value === "command" || value === "cmd") return "Win";
  return null;
}

function normalizeModifiers(modifiers: readonly string[]): string[] {
  const normalized = modifiers
    .map(normalizedModifier)
    .filter((modifier): modifier is typeof modifierOrder[number] => Boolean(modifier));
  return modifierOrder.filter((modifier) => normalized.includes(modifier));
}

function keyLabel(keyCode: string): string | null {
  const code = keyCode.trim();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code.startsWith("Arrow")) return code.slice(5);
  const labels: Record<string, string> = {
    Escape: "Esc",
    Space: "Space",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Delete: "Delete",
  };
  return labels[code] ?? null;
}

function isRecorderReservedKey(keyCode: string): boolean {
  return [
    "Tab",
    "Enter",
    "NumpadEnter",
    "Backspace",
    "CapsLock",
    "ContextMenu",
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "ShiftLeft",
    "ShiftRight",
    "MetaLeft",
    "MetaRight",
  ].includes(keyCode);
}

function isKeyboardShortcutActionId(value: string): value is KeyboardShortcutActionId {
  return actionIdSet.has(value);
}

export function bindingKey(binding: ShortcutBinding): string {
  const normalized = normalizeLocalShortcutBinding(binding);
  if (!normalized) return "";
  return `${normalized.modifiers.join("+")}::${normalized.keyCode}`;
}

export function normalizeLocalShortcutBinding(binding: ShortcutBinding): ShortcutBinding | null {
  const keyCode = binding.keyCode.trim();
  const label = keyLabel(keyCode);
  if (!label || isRecorderReservedKey(keyCode)) return null;
  const modifiers = normalizeModifiers(binding.modifiers);
  return {
    modifiers,
    keyCode,
    displayLabel: [...modifiers, label].join(" + "),
  };
}

export function shortcutFromKeyboardEvent(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  options: { requireCommandModifier: boolean },
): ShortcutCaptureResult {
  if (event.code === "Escape") return { status: "cancel" };
  if (event.code === "Backspace") return { status: "reset" };
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Win" : "",
  ].filter(Boolean);
  if (options.requireCommandModifier && !modifiers.some((modifier) => modifier === "Ctrl" || modifier === "Alt" || modifier === "Win")) {
    return { status: "invalid", message: "Use Ctrl, Alt, or Win with a regular key." };
  }
  const shortcut = normalizeLocalShortcutBinding({ modifiers, keyCode: event.code, displayLabel: "" });
  if (!shortcut) return { status: "invalid", message: "Use a regular key or supported key combination." };
  return { status: "captured", shortcut };
}

export function resolvedKeyboardShortcutBindings(settings: KeyboardShortcutSettings): Record<KeyboardShortcutActionId, ShortcutBinding> {
  const normalized = normalizeKeyboardShortcutSettings(settings);
  return keyboardShortcutActionIds.reduce((bindings, actionId) => {
    bindings[actionId] = normalized.bindings[actionId] ?? defaultKeyboardShortcutBindings[actionId];
    return bindings;
  }, {} as Record<KeyboardShortcutActionId, ShortcutBinding>);
}

export function normalizeKeyboardShortcutSettings(value: unknown): KeyboardShortcutSettings {
  const source = typeof value === "object" && value !== null ? value as Partial<KeyboardShortcutSettings> : {};
  const rawBindings = typeof source.bindings === "object" && source.bindings !== null ? source.bindings as Record<string, ShortcutBinding> : {};
  const bindings: KeyboardShortcutSettings["bindings"] = {};
  for (const [actionId, binding] of Object.entries(rawBindings)) {
    if (!isKeyboardShortcutActionId(actionId)) continue;
    const normalized = normalizeLocalShortcutBinding(binding);
    if (normalized) bindings[actionId] = normalized;
  }
  return { version: 1, bindings };
}

export function loadKeyboardShortcutSettings(): KeyboardShortcutSettings {
  try {
    const raw = localStorage.getItem(KEYBOARD_SHORTCUT_SETTINGS_KEY);
    return normalizeKeyboardShortcutSettings(raw ? JSON.parse(raw) : defaultKeyboardShortcutSettings);
  } catch {
    return defaultKeyboardShortcutSettings;
  }
}

export function saveKeyboardShortcutSettings(settings: KeyboardShortcutSettings) {
  localStorage.setItem(KEYBOARD_SHORTCUT_SETTINGS_KEY, JSON.stringify(normalizeKeyboardShortcutSettings(settings)));
}

export function conflictingKeyboardShortcutAction(
  settings: KeyboardShortcutSettings,
  actionId: KeyboardShortcutActionId,
  shortcut: ShortcutBinding,
): KeyboardShortcutActionId | null {
  const nextKey = bindingKey(shortcut);
  if (!nextKey) return null;
  const bindings = resolvedKeyboardShortcutBindings(settings);
  for (const candidate of keyboardShortcutActionIds) {
    if (candidate === actionId) continue;
    if (bindingKey(bindings[candidate]) === nextKey) return candidate;
  }
  return null;
}

export function shortcutMatchesEvent(
  binding: ShortcutBinding,
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): boolean {
  const normalized = normalizeLocalShortcutBinding(binding);
  if (!normalized || normalized.keyCode !== event.code) return false;
  const eventModifiers = normalizeModifiers([
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Win" : "",
  ].filter(Boolean));
  return normalized.modifiers.length === eventModifiers.length
    && normalized.modifiers.every((modifier, index) => modifier === eventModifiers[index]);
}

export function keyboardShortcutActionForEvent(
  settings: KeyboardShortcutSettings,
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  actionIds: readonly KeyboardShortcutActionId[],
): KeyboardShortcutActionId | null {
  const bindings = resolvedKeyboardShortcutBindings(settings);
  return actionIds.find((actionId) => shortcutMatchesEvent(bindings[actionId], event)) ?? null;
}
```

- [ ] **Step 4: Run the green check**

Run:

```text
npm run check:keyboard-shortcuts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```text
git add package.json scripts/keyboard-shortcuts-unit-check.mjs src/lib/keyboard-shortcuts.ts
git commit -m "feat: add keyboard shortcut settings model"
```

### Task 2: Settings State And Shortcuts Panel Editing

**Files:**
- Modify: `src/lib/state/settings.svelte.ts`
- Modify: `src/lib/shortcuts.ts`
- Modify: `src/lib/GlobalShortcutEditor.svelte`
- Modify: `src/lib/ShortcutsPanel.svelte`
- Modify: `src/lib/AdvancedPanel.svelte`
- Modify: `src/lib/BookshelfView.svelte`
- Modify: `src/lib/BookshelfProbe.svelte`
- Modify: `src/lib/DictionarySearchProbe.svelte`
- Modify: `src/lib/GlobalLookupSettingsProbe.svelte`
- Modify: `scripts/bookshelf-check.mjs`
- Modify: `scripts/global-lookup-settings-check.mjs`

- [ ] **Step 1: Write the failing Shortcuts panel probe assertions**

In `scripts/bookshelf-check.mjs`, inside the existing `if (panel === "Shortcuts")` block, add assertions:

```js
const shortcutsRegion = page.getByRole("region", { name: "Keyboard shortcuts", exact: true });
const recordCount = await shortcutsRegion.getByRole("button", { name: "Record", exact: true }).count();
const resetCount = await shortcutsRegion.getByRole("button", { name: "Reset", exact: true }).count();
assert(recordCount >= 9, "Shortcuts panel should expose Record controls for Global, Reader, and Sasayaki keyboard shortcuts.", { recordCount });
assert(resetCount >= 9, "Shortcuts panel should expose Reset controls for Global, Reader, and Sasayaki keyboard shortcuts.", { resetCount });
```

Run:

```text
npm run check:bookshelf
```

Expected: FAIL because only the global shortcut row has editing controls.

- [ ] **Step 2: Wire keyboard shortcut settings into settings state**

In `src/lib/state/settings.svelte.ts`, import the new module:

```ts
import {
  conflictingKeyboardShortcutAction,
  defaultKeyboardShortcutSettings,
  loadKeyboardShortcutSettings,
  normalizeKeyboardShortcutSettings,
  saveKeyboardShortcutSettings,
  type KeyboardShortcutActionId,
  type KeyboardShortcutSettings,
} from "../keyboard-shortcuts";
import type { ShortcutBinding } from "../global-lookup-settings";
```

Extend `SettingsPersistence`:

```ts
loadKeyboardShortcutSettings: () => KeyboardShortcutSettings;
saveKeyboardShortcutSettings: (settings: KeyboardShortcutSettings) => void;
```

Add both functions to `browserSettingsPersistence`.

Inside `createSettingsState`, add state and methods:

```ts
let keyboardShortcutSettings = $state<KeyboardShortcutSettings>(
  normalizeKeyboardShortcutSettings(persistence.loadKeyboardShortcutSettings()),
);
function setKeyboardShortcut(actionId: KeyboardShortcutActionId, shortcut: ShortcutBinding): string {
  const conflict = conflictingKeyboardShortcutAction(keyboardShortcutSettings, actionId, shortcut);
  if (conflict) {
    return conflict;
  }
  keyboardShortcutSettings = normalizeKeyboardShortcutSettings({
    ...keyboardShortcutSettings,
    bindings: { ...keyboardShortcutSettings.bindings, [actionId]: shortcut },
  });
  persistence.saveKeyboardShortcutSettings(keyboardShortcutSettings);
  return "";
}

function resetKeyboardShortcut(actionId: KeyboardShortcutActionId) {
  const bindings = { ...keyboardShortcutSettings.bindings };
  delete bindings[actionId];
  keyboardShortcutSettings = { version: 1, bindings };
  persistence.saveKeyboardShortcutSettings(keyboardShortcutSettings);
}
```

Return the getters and methods:

```ts
get keyboardShortcutSettings() { return keyboardShortcutSettings; },
setKeyboardShortcut,
resetKeyboardShortcut,
```

- [ ] **Step 3: Convert the shortcuts registry to use app-local settings**

Modify `src/lib/shortcuts.ts` so it imports app-local defaults and resolved bindings:

```ts
import {
  defaultKeyboardShortcutBindings,
  resolvedKeyboardShortcutBindings,
  type KeyboardShortcutActionId,
  type KeyboardShortcutSettings,
} from "./keyboard-shortcuts";
import { defaultGlobalLookupShortcut, type GlobalLookupSettings, type ShortcutBinding as KeyboardShortcutBinding } from "./global-lookup-settings";
```

Use this action shape:

```ts
export type ShortcutDisplayBinding = {
  tokens: readonly string[];
  editable?: boolean;
  shortcut?: KeyboardShortcutBinding;
};

export type ShortcutAction = {
  id: string;
  label: string;
  detail?: string;
  editableActionId?: KeyboardShortcutActionId | "global-selected-text-lookup";
  bindings: readonly ShortcutDisplayBinding[];
};
```

Add helpers:

```ts
function tokensForShortcut(shortcut: KeyboardShortcutBinding): string[] {
  return shortcut.displayLabel.split("+").map((token) => token.trim()).filter(Boolean);
}

function editableBinding(shortcut: KeyboardShortcutBinding): ShortcutDisplayBinding {
  return { tokens: tokensForShortcut(shortcut), editable: true, shortcut };
}
```

Make `shortcutGroups` accept both settings:

```ts
export function shortcutGroups(
  globalLookupSettings?: GlobalLookupSettings | null,
  keyboardShortcutSettings = defaultKeyboardShortcutSettings,
): readonly ShortcutGroup[] {
  const keyboard = resolvedKeyboardShortcutBindings(keyboardShortcutSettings);
  const globalLookup = globalLookupSettings ?? { enabled: true, shortcut: defaultGlobalLookupShortcut };
  return [
    {
      id: "global",
      label: "Global",
      actions: [
        {
          id: "global-selected-text-lookup",
          label: "Look up selected text",
          detail: globalLookup.enabled ? "Works in Windows apps that expose selected text through UI Automation." : "Disabled in Advanced settings.",
          editableActionId: "global-selected-text-lookup",
          bindings: [editableBinding(globalLookup.shortcut)],
        },
      ],
    },
    {
      id: "reader",
      label: "Reader",
      actions: [
        { id: "reader-next-page", label: "Next page", editableActionId: "reader-next-page", bindings: [editableBinding(keyboard["reader-next-page"]), { tokens: ["Wheel down"] }] },
        { id: "reader-previous-page", label: "Previous page", editableActionId: "reader-previous-page", bindings: [editableBinding(keyboard["reader-previous-page"]), { tokens: ["Wheel up"] }] },
        { id: "reader-next-chapter", label: "Next chapter", editableActionId: "reader-next-chapter", bindings: [editableBinding(keyboard["reader-next-chapter"]), { tokens: ["Ctrl", "Wheel down"] }] },
        { id: "reader-previous-chapter", label: "Previous chapter", editableActionId: "reader-previous-chapter", bindings: [editableBinding(keyboard["reader-previous-chapter"]), { tokens: ["Ctrl", "Wheel up"] }] },
        { id: "reader-lookup-at-pointer", label: "Look up text at pointer", detail: "Hold Shift while hovering over reader text.", bindings: [{ tokens: ["Shift", "Hover"] }] },
        { id: "reader-close", label: "Clear selection and return", detail: "Clears active lookup first, then closes reader UI or returns to Library.", editableActionId: "reader-close", bindings: [editableBinding(keyboard["reader-close"])] },
      ],
    },
    {
      id: "sasayaki",
      label: "Sasayaki",
      actions: [
        { id: "sasayaki-toggle-playback", label: "Toggle playback", detail: "When Sasayaki audio is available in the reader.", editableActionId: "sasayaki-toggle-playback", bindings: [editableBinding(keyboard["sasayaki-toggle-playback"])] },
        { id: "sasayaki-previous-skip-action", label: "Skip backward", detail: "Uses the current Sasayaki skip action.", editableActionId: "sasayaki-previous-skip-action", bindings: [editableBinding(keyboard["sasayaki-previous-skip-action"])] },
        { id: "sasayaki-next-skip-action", label: "Skip forward", detail: "Uses the current Sasayaki skip action.", editableActionId: "sasayaki-next-skip-action", bindings: [editableBinding(keyboard["sasayaki-next-skip-action"])] },
      ],
    },
  ];
}
```

- [ ] **Step 4: Make the recorder support local and global modes**

In `src/lib/GlobalShortcutEditor.svelte`, replace the import from `global-lookup-settings` with:

```ts
import { shortcutFromKeyboardEvent } from "./keyboard-shortcuts";
import type { ShortcutBinding } from "./global-lookup-settings";
```

Add props:

```ts
defaultShortcut?: ShortcutBinding;
requireCommandModifier?: boolean;
externalError?: string;
```

Default them in `$props()`:

```ts
defaultShortcut = shortcut,
requireCommandModifier = true,
externalError = "",
```

Change capture:

```ts
const result = shortcutFromKeyboardEvent(event, { requireCommandModifier });
```

Change the recording status:

```svelte
<p class="shortcut-message">Press a shortcut. Esc cancels, Backspace resets to {defaultShortcut.displayLabel}.</p>
```

Display errors:

```svelte
{#if recordingError || externalError}
  <p class="shortcut-message shortcut-error">{recordingError || externalError}</p>
{:else if recordingShortcut}
  <p class="shortcut-message">Press a shortcut. Esc cancels, Backspace resets to {defaultShortcut.displayLabel}.</p>
{/if}
```

In `src/lib/AdvancedPanel.svelte`, pass global mode explicitly:

```svelte
<GlobalShortcutEditor
  shortcut={globalLookupSettings.shortcut}
  defaultShortcut={defaultGlobalLookupShortcut}
  requireCommandModifier={true}
  onShortcutChange={onGlobalLookupShortcutChange}
  onShortcutReset={onGlobalLookupShortcutReset}
/>
```

- [ ] **Step 5: Render editors for every editable Shortcuts row**

In `src/lib/ShortcutsPanel.svelte`, add props:

```ts
keyboardShortcutSettings,
onKeyboardShortcutChange = (_actionId, _shortcut) => "",
onKeyboardShortcutReset = (_actionId) => {},
```

with types:

```ts
import {
  defaultKeyboardShortcutBindings,
  defaultKeyboardShortcutSettings,
  type KeyboardShortcutActionId,
  type KeyboardShortcutSettings,
} from "./keyboard-shortcuts";
import { defaultGlobalLookupShortcut } from "./global-lookup-settings";
```

Call:

```ts
const groups = $derived(shortcutGroups(globalLookupSettings, keyboardShortcutSettings));
```

Add row-scoped conflict state:

```ts
let shortcutErrors = $state<Record<string, string>>({});

const actionLabels = $derived(new Map(
  groups.flatMap((group) => group.actions.map((action) => [action.id, action.label] as const)),
));

function setLocalShortcut(actionId: KeyboardShortcutActionId, shortcut: ShortcutBinding) {
  const conflict = onKeyboardShortcutChange(actionId, shortcut);
  shortcutErrors = {
    ...shortcutErrors,
    [actionId]: conflict ? `Already used by ${actionLabels.get(conflict) ?? conflict}.` : "",
  };
}

function resetLocalShortcut(actionId: KeyboardShortcutActionId) {
  onKeyboardShortcutReset(actionId);
  shortcutErrors = { ...shortcutErrors, [actionId]: "" };
}
```

Replace the current global-only editable branch with a generic branch:

```svelte
{#if action.editableActionId === "global-selected-text-lookup" && globalLookupSettings && onGlobalLookupShortcutChange && onGlobalLookupShortcutReset}
  <GlobalShortcutEditor
    shortcut={globalLookupSettings.shortcut}
    defaultShortcut={defaultGlobalLookupShortcut}
    requireCommandModifier={true}
    onShortcutChange={onGlobalLookupShortcutChange}
    onShortcutReset={onGlobalLookupShortcutReset}
  />
{:else if action.editableActionId && action.editableActionId !== "global-selected-text-lookup"}
  {@const localActionId = action.editableActionId as KeyboardShortcutActionId}
  {@const editable = action.bindings.find((binding) => binding.editable)?.shortcut}
  {#if editable}
    <div class="editable-bindings">
      <GlobalShortcutEditor
        shortcut={editable}
        defaultShortcut={defaultKeyboardShortcutBindings[localActionId]}
        requireCommandModifier={false}
        externalError={shortcutErrors[localActionId] ?? ""}
        onShortcutChange={(shortcut) => setLocalShortcut(localActionId, shortcut)}
        onShortcutReset={() => resetLocalShortcut(localActionId)}
      />
      <div class="bindings fixed-bindings" aria-label={`${action.label} fixed shortcuts`}>
        {#each action.bindings.filter((binding) => !binding.editable) as binding}
          <span class="binding">
            {#each binding.tokens as token, tokenIndex}
              {#if tokenIndex > 0}<span class="binding-plus">+</span>{/if}
              <kbd>{token}</kbd>
            {/each}
          </span>
        {/each}
      </div>
    </div>
  {/if}
{:else}
  <div class="bindings" aria-label={`${action.label} shortcuts`}>
    {#each action.bindings as binding, bindingIndex}
      {#if bindingIndex > 0}<span class="binding-or">or</span>{/if}
      <span class="binding">
        {#each binding.tokens as token, tokenIndex}
          {#if tokenIndex > 0}<span class="binding-plus">+</span>{/if}
          <kbd>{token}</kbd>
        {/each}
      </span>
    {/each}
  </div>
{/if}
```

Add CSS:

```css
.editable-bindings { min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.fixed-bindings:empty { display: none; }
@media (max-width: 640px) {
  .editable-bindings { align-items: flex-start; }
}
```

- [ ] **Step 6: Wire Bookshelf/App/probes**

In `src/lib/BookshelfView.svelte`, add props and forward them to `ShortcutsPanel`:

```svelte
keyboardShortcutSettings={settings.keyboardShortcutSettings}
onKeyboardShortcutChange={settings.setKeyboardShortcut}
onKeyboardShortcutReset={settings.resetKeyboardShortcut}
```

At the `BookshelfView` boundary, add typed props:

```ts
keyboardShortcutSettings: KeyboardShortcutSettings;
onSetKeyboardShortcut: (actionId: KeyboardShortcutActionId, shortcut: ShortcutBinding) => string;
onResetKeyboardShortcut: (actionId: KeyboardShortcutActionId) => void;
```

In `src/App.svelte`, pass those props from `settings`.

In `src/lib/BookshelfProbe.svelte` and `src/lib/DictionarySearchProbe.svelte`, import `defaultKeyboardShortcutSettings` and pass no-op handlers:

```svelte
keyboardShortcutSettings={defaultKeyboardShortcutSettings}
onSetKeyboardShortcut={() => ""}
onResetKeyboardShortcut={() => {}}
```

In `src/lib/GlobalLookupSettingsProbe.svelte`, track local shortcut settings:

```ts
import {
  defaultKeyboardShortcutSettings,
  normalizeKeyboardShortcutSettings,
  type KeyboardShortcutActionId,
} from "./keyboard-shortcuts";

let keyboardShortcutSettings = $state(defaultKeyboardShortcutSettings);

function setKeyboardShortcut(actionId: KeyboardShortcutActionId, shortcut: ShortcutBinding) {
  keyboardShortcutSettings = normalizeKeyboardShortcutSettings({
    ...keyboardShortcutSettings,
    bindings: { ...keyboardShortcutSettings.bindings, [actionId]: shortcut },
  });
  events = [...events, `local:${actionId}:${shortcut.displayLabel}`];
  return "";
}

function resetKeyboardShortcut(actionId: KeyboardShortcutActionId) {
  const bindings = { ...keyboardShortcutSettings.bindings };
  delete bindings[actionId];
  keyboardShortcutSettings = { version: 1, bindings };
  events = [...events, `local-reset:${actionId}`];
}
```

Pass the settings and handlers to `ShortcutsPanel`.

- [ ] **Step 7: Run green panel checks**

Run:

```text
npm run check:keyboard-shortcuts
npm run check:global-lookup-settings
npm run check:bookshelf
npm run check
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 2**

```text
git add src/lib/state/settings.svelte.ts src/lib/shortcuts.ts src/lib/GlobalShortcutEditor.svelte src/lib/ShortcutsPanel.svelte src/lib/AdvancedPanel.svelte src/lib/BookshelfView.svelte src/lib/BookshelfProbe.svelte src/lib/DictionarySearchProbe.svelte src/lib/GlobalLookupSettingsProbe.svelte scripts/bookshelf-check.mjs scripts/global-lookup-settings-check.mjs
git commit -m "feat: make shortcut panel edit local key bindings"
```

### Task 3: Reader Dispatch From Configured Shortcuts

**Files:**
- Modify: `src/lib/reader/Reader.svelte`
- Modify: `src/lib/reader/ReaderVisualProbe.svelte`
- Modify: `src/App.svelte`
- Modify: `scripts/reader-visual-check.mjs`

- [ ] **Step 1: Write the failing Reader probe**

In `src/lib/reader/ReaderVisualProbe.svelte`, import:

```ts
import {
  defaultKeyboardShortcutSettings,
  normalizeKeyboardShortcutSettings,
} from "../keyboard-shortcuts";
```

Add:

```ts
const customShortcuts = params.get("customShortcuts") === "reader";
const keyboardShortcutSettings = customShortcuts
  ? normalizeKeyboardShortcutSettings({
      version: 1,
      bindings: {
        "reader-next-page": { modifiers: [], keyCode: "KeyN", displayLabel: "N" },
        "reader-previous-page": { modifiers: [], keyCode: "KeyB", displayLabel: "B" },
        "reader-next-chapter": { modifiers: ["Alt"], keyCode: "KeyN", displayLabel: "Alt + N" },
        "reader-previous-chapter": { modifiers: ["Alt"], keyCode: "KeyB", displayLabel: "Alt + B" },
        "reader-close": { modifiers: [], keyCode: "KeyQ", displayLabel: "Q" },
      },
    })
  : defaultKeyboardShortcutSettings;
let backEvents = $state(0);
```

Pass to `Reader`:

```svelte
keyboardShortcutSettings={keyboardShortcutSettings}
onBackToShelf={() => backEvents += 1}
```

Expose in `.probe-state`:

```svelte
data-back-events={backEvents}
```

In `scripts/reader-visual-check.mjs`, add a focused function after existing navigation helpers:

```js
async function keyboardShortcutState(page) {
  return page.locator(".probe-state").evaluate((element) => ({
    chapter: element.getAttribute("data-chapter-index"),
    page: element.getAttribute("data-current-page"),
    backEvents: element.getAttribute("data-back-events"),
  }));
}

async function verifyCustomReaderShortcuts(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  await page.goto(`${origin}/?readerVisualProbe=1&customShortcuts=reader`);
  await page.locator(".rv.ready").waitFor();

  let before = await keyboardShortcutState(page);
  await page.keyboard.press("ArrowLeft");
  let afterOld = await keyboardShortcutState(page);
  assert(afterOld.page === before.page && afterOld.chapter === before.chapter, "Default ArrowLeft should not advance when next page is customized.", { before, afterOld });

  await page.keyboard.press("n");
  let afterNext = await keyboardShortcutState(page);
  assert(afterNext.page !== before.page || afterNext.chapter !== before.chapter, "Custom N shortcut should advance reader paging.", { before, afterNext });

  await page.keyboard.press("Alt+n");
  let afterChapter = await keyboardShortcutState(page);
  assert(afterChapter.chapter === "1", "Custom Alt+N shortcut should advance to the next chapter.", afterChapter);

  await page.keyboard.press("q");
  let afterClose = await keyboardShortcutState(page);
  assert(afterClose.backEvents === "1", "Custom Q shortcut should trigger reader close/back behavior.", afterClose);
}
```

Call it from `main()` after the existing reader flow:

```js
await verifyCustomReaderShortcuts(browser, origin);
```

Run:

```text
npm run check:reader-visual
```

Expected: FAIL because `Reader` ignores `keyboardShortcutSettings`.

- [ ] **Step 2: Wire Reader props and matcher**

In `src/lib/reader/Reader.svelte`, import:

```ts
import {
  defaultKeyboardShortcutSettings,
  keyboardShortcutActionForEvent,
  type KeyboardShortcutSettings,
} from "../keyboard-shortcuts";
```

Add prop:

```ts
keyboardShortcutSettings = defaultKeyboardShortcutSettings,
```

with type:

```ts
keyboardShortcutSettings?: KeyboardShortcutSettings;
```

Replace hard-coded non-Shift key branches in `handleKey`:

```ts
const action = keyboardShortcutActionForEvent(keyboardShortcutSettings, e, [
  "reader-next-chapter",
  "reader-previous-chapter",
  "reader-previous-page",
  "reader-next-page",
  "reader-close",
]);
if (!action) return;

if (action === "reader-next-chapter") {
  e.preventDefault();
  onNextChapter();
} else if (action === "reader-previous-chapter") {
  e.preventDefault();
  onPrevChapterDirect();
} else if (action === "reader-previous-page") {
  e.preventDefault();
  prevPage();
} else if (action === "reader-next-page") {
  e.preventDefault();
  nextPage();
} else if (action === "reader-close") {
  if (hasActiveSelection) {
    e.preventDefault();
    clearSelection();
    return;
  }
  onBackToShelf();
}
```

Keep the existing Shift branch before matcher:

```ts
if (e.key === "Shift") {
  const wasShiftPressed = shiftKeyPressed;
  shiftKeyPressed = true;
  if (!wasShiftPressed && lastPointer && shouldScheduleShiftHoverLookup(lastPointer)) {
    scheduleShiftHoverLookup();
  }
  return;
}
```

In `src/App.svelte`, pass:

```svelte
keyboardShortcutSettings={settings.keyboardShortcutSettings}
```

- [ ] **Step 3: Run Reader green checks**

Run:

```text
npm run check:keyboard-shortcuts
npm run check:reader-visual
npm run check
```

Expected: all PASS.

- [ ] **Step 4: Commit Task 3**

```text
git add src/lib/reader/Reader.svelte src/lib/reader/ReaderVisualProbe.svelte src/App.svelte scripts/reader-visual-check.mjs
git commit -m "feat: dispatch reader keyboard shortcuts from settings"
```

### Task 4: Sasayaki Dispatch From Configured Shortcuts

**Files:**
- Modify: `src/lib/sasayaki-shortcuts.ts`
- Modify: `src/App.svelte`
- Modify: `src/lib/SasayakiPlaybackProbe.svelte`
- Modify: `scripts/sasayaki-playback-check.mjs`

- [ ] **Step 1: Write the failing Sasayaki probe**

In `src/lib/SasayakiPlaybackProbe.svelte`, import:

```ts
import {
  defaultKeyboardShortcutSettings,
  normalizeKeyboardShortcutSettings,
} from "./keyboard-shortcuts";
```

Add:

```ts
const params = new URLSearchParams(window.location.search);
const keyboardShortcutSettings = params.get("customShortcuts") === "sasayaki"
  ? normalizeKeyboardShortcutSettings({
      version: 1,
      bindings: {
        "sasayaki-toggle-playback": { modifiers: [], keyCode: "KeyT", displayLabel: "T" },
        "sasayaki-previous-skip-action": { modifiers: [], keyCode: "Comma", displayLabel: "," },
        "sasayaki-next-skip-action": { modifiers: [], keyCode: "Period", displayLabel: "." },
      },
    })
  : defaultKeyboardShortcutSettings;
```

Change:

```ts
const action = sasayakiShortcutAction(event);
```

to:

```ts
const action = sasayakiShortcutAction(event, keyboardShortcutSettings);
```

In `scripts/sasayaki-playback-check.mjs`, add a focused function:

```js
async function verifyCustomSasayakiShortcuts(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  await page.goto(`${origin}/?sasayakiPlaybackProbe=1&customShortcuts=sasayaki`);
  await page.locator(".probe-state").waitFor();

  await page.keyboard.press("p");
  await page.keyboard.press("[");
  await page.keyboard.press("]");
  assert(await events(page) === "", "Default Sasayaki keys should not fire when custom bindings are active.");

  await page.keyboard.press("t");
  await page.keyboard.press(",");
  await page.keyboard.press(".");
  assert(await events(page) === "play,previous:5.25,next:15.25", "Custom Sasayaki keys should drive playback and skip actions.");

  const panel = page.getByRole("region", { name: "Sasayaki playback", exact: true });
  await page.getByRole("button", { name: "Open Sasayaki playback", exact: true }).click();
  await panel.getByLabel("Sasayaki playback speed").focus();
  const beforeFocused = await events(page);
  await page.keyboard.press("t");
  assert(await events(page) === beforeFocused, "Custom Sasayaki shortcuts should not fire from focused playback controls.");
}
```

Call it from `main()` after the existing Sasayaki checks:

```js
await verifyCustomSasayakiShortcuts(browser, origin);
```

Run:

```text
npm run check:sasayaki-playback
```

Expected: FAIL because `sasayakiShortcutAction` still uses fixed keys.

- [ ] **Step 2: Update Sasayaki shortcut matcher**

In `src/lib/sasayaki-shortcuts.ts`, import:

```ts
import {
  defaultKeyboardShortcutSettings,
  keyboardShortcutActionForEvent,
  type KeyboardShortcutSettings,
} from "./keyboard-shortcuts";
```

Change `sasayakiShortcutAction`:

```ts
export function sasayakiShortcutAction(
  event: KeyboardEvent,
  settings: KeyboardShortcutSettings = defaultKeyboardShortcutSettings,
): SasayakiShortcutAction | null {
  if (isEditableShortcutTarget(event.target)) return null;

  const action = keyboardShortcutActionForEvent(settings, event, [
    "sasayaki-toggle-playback",
    "sasayaki-previous-skip-action",
    "sasayaki-next-skip-action",
  ]);
  if (action === "sasayaki-toggle-playback") return "togglePlayback";
  if (action === "sasayaki-previous-skip-action") return "previous";
  if (action === "sasayaki-next-skip-action") return "next";
  return null;
}
```

In `src/App.svelte`, change:

```ts
const action = sasayakiShortcutAction(event);
```

to:

```ts
const action = sasayakiShortcutAction(event, settings.keyboardShortcutSettings);
```

- [ ] **Step 3: Run Sasayaki green checks**

Run:

```text
npm run check:keyboard-shortcuts
npm run check:sasayaki-playback
npm run check
```

Expected: all PASS.

- [ ] **Step 4: Commit Task 4**

```text
git add src/lib/sasayaki-shortcuts.ts src/App.svelte src/lib/SasayakiPlaybackProbe.svelte scripts/sasayaki-playback-check.mjs
git commit -m "feat: dispatch sasayaki keyboard shortcuts from settings"
```

### Task 5: Docs And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Update README facts**

In `README.md`, update the Shortcuts line to:

```md
- Built-in shortcuts panel with editable global, Reader, and Sasayaki keyboard shortcuts plus read-only mouse gesture reference
```

Update the keyboard section text to:

```md
The Shortcuts panel can record and reset keyboard shortcuts for global selected-text lookup, Reader navigation, Reader close/clear-selection behavior, and Sasayaki playback controls. Mouse wheel navigation, Shift hover lookup, and left-click lookup remain fixed gestures.
```

- [ ] **Step 2: Update PROJECT_STATUS facts**

In `docs/PROJECT_STATUS.md`, replace the current Shortcuts fact with:

```md
  - Shortcuts panel lists implemented global, Reader, and Sasayaki keyboard/mouse shortcuts by feature group; global, Reader, and Sasayaki keyboard shortcuts are editable and resettable, while wheel, Shift-hover, and click gestures remain informational fixed bindings.
```

Add a validation command line:

```md
- Keyboard shortcut settings regression probe: `npm run check:keyboard-shortcuts`
```

- [ ] **Step 3: Run full required validation**

Run:

```text
npm run check:keyboard-shortcuts
npm run check:global-lookup-settings
npm run check:bookshelf
npm run check:reader-visual
npm run check:sasayaki-playback
npm run check
npm run build
git diff --check
```

Expected: all commands exit 0. The Vite build may keep the existing chunk-size warning.

- [ ] **Step 4: Commit Task 5**

```text
git add README.md docs/PROJECT_STATUS.md
git commit -m "docs: document configurable keyboard shortcuts"
```

## Self-Review Notes

- Spec coverage: Tasks cover app-local model, persistence, Shortcuts UI, Reader dispatch, Sasayaki dispatch, global recorder compatibility, fixed mouse gestures, conflict handling, docs, and required validation.
- Scope: Mouse wheel, Shift hover, and left-click lookup remain fixed and read-only in this plan.
- Type consistency: `ShortcutBinding` remains the existing global lookup shape; app-local action ids use `KeyboardShortcutActionId`; global lookup keeps its existing `globalLookupSettings` storage.
