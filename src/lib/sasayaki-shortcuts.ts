export type SasayakiShortcutAction = "togglePlayback" | "previous" | "next";

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

export function sasayakiShortcutAction(event: KeyboardEvent): SasayakiShortcutAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey || isEditableShortcutTarget(event.target)) return null;

  const key = event.key.toLowerCase();
  if (event.code === "KeyP" || key === "p") return "togglePlayback";
  if (event.code === "BracketLeft" || event.key === "[") return "previous";
  if (event.code === "BracketRight" || event.key === "]") return "next";
  return null;
}
