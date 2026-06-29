export interface ShortcutBinding {
  modifiers: string[];
  keyCode: string;
  displayLabel: string;
}

export interface GlobalShortcutRegistration {
  registered: boolean;
  error: string | null;
}

export interface GlobalLookupSettings {
  version: number;
  enabled: boolean;
  shortcut: ShortcutBinding;
  registration: GlobalShortcutRegistration;
}

export const defaultGlobalLookupShortcut: ShortcutBinding = {
  modifiers: ["Ctrl", "Alt"],
  keyCode: "KeyH",
  displayLabel: "Ctrl + Alt + H",
};

export const defaultGlobalLookupSettings: GlobalLookupSettings = {
  version: 1,
  enabled: false,
  shortcut: defaultGlobalLookupShortcut,
  registration: { registered: false, error: null },
};

export type ShortcutCaptureResult =
  | { status: "captured"; shortcut: ShortcutBinding }
  | { status: "cancel" }
  | { status: "reset" }
  | { status: "invalid"; message: string };

const modifierOrder = ["Ctrl", "Alt", "Shift", "Win"] as const;

function keyLabel(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code.startsWith("Arrow")) return code.slice(5);
  const labels: Record<string, string> = {
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

function isReservedKey(code: string): boolean {
  return [
    "Escape",
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
  ].includes(code);
}

export function shortcutTokens(shortcut: ShortcutBinding | null | undefined): string[] {
  if (!shortcut) return [];
  return shortcut.displayLabel.split("+").map((token) => token.trim()).filter(Boolean);
}

export function normalizeShortcutBinding(shortcut: ShortcutBinding): ShortcutBinding | null {
  const modifiers = modifierOrder.filter((modifier) => shortcut.modifiers.includes(modifier));
  const label = keyLabel(shortcut.keyCode);
  if (!label || isReservedKey(shortcut.keyCode)) return null;
  if (!modifiers.some((modifier) => modifier === "Ctrl" || modifier === "Alt" || modifier === "Win")) return null;
  return {
    modifiers,
    keyCode: shortcut.keyCode,
    displayLabel: [...modifiers, label].join(" + "),
  };
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutCaptureResult {
  if (event.code === "Escape") return { status: "cancel" };
  if (event.code === "Backspace") return { status: "reset" };

  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Win" : "",
  ].filter(Boolean);
  const shortcut = normalizeShortcutBinding({
    modifiers,
    keyCode: event.code,
    displayLabel: "",
  });
  if (!shortcut) {
    return { status: "invalid", message: "Use Ctrl, Alt, or Win with a regular key." };
  }
  return { status: "captured", shortcut };
}
