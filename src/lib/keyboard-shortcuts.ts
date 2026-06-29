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
type ShortcutBindingInput = { modifiers: string[]; keyCode: string };

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

function shortcutBindingInput(value: unknown): ShortcutBindingInput | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { modifiers?: unknown; keyCode?: unknown };
  const modifiers = candidate.modifiers;
  if (!Array.isArray(modifiers) || !modifiers.every((modifier): modifier is string => typeof modifier === "string")) return null;
  if (typeof candidate.keyCode !== "string") return null;
  return { modifiers, keyCode: candidate.keyCode };
}

function normalizeShortcutBindingInput(binding: ShortcutBindingInput): ShortcutBinding | null {
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

export function bindingKey(binding: ShortcutBinding): string {
  const normalized = normalizeLocalShortcutBinding(binding);
  if (!normalized) return "";
  return `${normalized.modifiers.join("+")}::${normalized.keyCode}`;
}

export function normalizeLocalShortcutBinding(binding: ShortcutBinding): ShortcutBinding | null {
  const input = shortcutBindingInput(binding);
  return input ? normalizeShortcutBindingInput(input) : null;
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
  const rawBindings = typeof source.bindings === "object" && source.bindings !== null ? source.bindings as Record<string, unknown> : {};
  const bindings: KeyboardShortcutSettings["bindings"] = {};
  for (const [actionId, binding] of Object.entries(rawBindings)) {
    if (!isKeyboardShortcutActionId(actionId)) continue;
    const input = shortcutBindingInput(binding);
    const normalized = input ? normalizeShortcutBindingInput(input) : null;
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
