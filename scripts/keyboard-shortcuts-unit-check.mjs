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
  const settingsState = await server.ssrLoadModule("/src/lib/state/settings.svelte.ts");
  const appearance = await server.ssrLoadModule("/src/lib/appearance.ts");
  const advanced = await server.ssrLoadModule("/src/lib/advanced-settings.ts");
  const popupSettings = await server.ssrLoadModule("/src/lib/lookup-popup-settings.ts");
  const dictionarySettings = await server.ssrLoadModule("/src/lib/dictionary-settings.ts");

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

  const savedKeyboardShortcutSettings = [];
  const settings = settingsState.createSettingsState({
    loadReaderAppearance: () => appearance.defaultReaderAppearance,
    saveReaderAppearance: () => {},
    loadAdvancedSettings: () => advanced.defaultAdvancedSettings,
    saveAdvancedSettings: () => {},
    loadLookupPopupSettings: () => popupSettings.defaultLookupPopupSettings,
    saveLookupPopupSettings: () => {},
    loadDictionarySettings: () => dictionarySettings.defaultDictionarySettings,
    saveDictionarySettings: () => {},
    loadKeyboardShortcutSettings: () => shortcuts.defaultKeyboardShortcutSettings,
    saveKeyboardShortcutSettings: (next) => savedKeyboardShortcutSettings.push(next),
  });
  const nextPageOverride = { modifiers: [], keyCode: "KeyN", displayLabel: "N" };
  assert(settings.setKeyboardShortcut("reader-next-page", nextPageOverride) === "", "Moving an action off its default should succeed.");
  assert(
    settings.setKeyboardShortcut("reader-previous-page", shortcuts.defaultKeyboardShortcutBindings["reader-next-page"]) === "",
    "Assigning another action to the now-unused default should succeed.",
  );
  const resetConflict = settings.resetKeyboardShortcut("reader-next-page");
  assert(resetConflict === "reader-previous-page", "Reset should report the action that currently uses the default shortcut.", { resetConflict });
  assert(
    settings.keyboardShortcutSettings.bindings["reader-next-page"]?.displayLabel === "N",
    "Reset conflict should preserve the existing override.",
    settings.keyboardShortcutSettings,
  );
  assert(savedKeyboardShortcutSettings.length === 2, "Reset conflict should not persist duplicate local shortcuts.", savedKeyboardShortcutSettings);

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

  const malformed = shortcuts.normalizeKeyboardShortcutSettings({
    version: 1,
    bindings: {
      "reader-next-page": { modifiers: ["Shift"], keyCode: "KeyN", displayLabel: "ignored" },
      "reader-previous-page": null,
      "reader-next-chapter": { keyCode: "KeyJ", displayLabel: "J" },
      "reader-previous-chapter": { modifiers: [1], keyCode: "KeyK", displayLabel: "K" },
      "reader-close": { modifiers: [], keyCode: 42, displayLabel: "42" },
    },
  });
  assert(malformed.bindings["reader-next-page"].displayLabel === "Shift + N", "Malformed persisted bindings should not discard valid overrides.", malformed);
  assert(!("reader-previous-page" in malformed.bindings), "Null persisted bindings should be ignored.", malformed);
  assert(!("reader-next-chapter" in malformed.bindings), "Persisted bindings without modifiers should be ignored.", malformed);
  assert(!("reader-previous-chapter" in malformed.bindings), "Persisted bindings with non-string modifiers should be ignored.", malformed);
  assert(!("reader-close" in malformed.bindings), "Persisted bindings with non-string key codes should be ignored.", malformed);
} finally {
  await server.close();
}
