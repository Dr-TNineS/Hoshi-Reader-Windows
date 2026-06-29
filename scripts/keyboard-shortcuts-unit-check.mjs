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
