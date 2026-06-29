import {
  defaultKeyboardShortcutSettings,
  keyboardShortcutActionForEvent,
  type KeyboardShortcutSettings,
} from "./keyboard-shortcuts";

export type SasayakiShortcutAction = "togglePlayback" | "previous" | "next";

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

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
