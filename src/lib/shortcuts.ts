import {
  defaultGlobalLookupShortcut,
  shortcutTokens,
  type GlobalLookupSettings,
  type ShortcutBinding as KeyboardBinding,
} from "./global-lookup-settings";
import {
  defaultKeyboardShortcutSettings,
  resolvedKeyboardShortcutBindings,
  type KeyboardShortcutActionId,
  type KeyboardShortcutSettings,
} from "./keyboard-shortcuts";

export type ShortcutBinding = {
  tokens: readonly string[];
  editable?: boolean;
  shortcut?: KeyboardBinding;
};

export type ShortcutAction = {
  id: string;
  label: string;
  detail?: string;
  editableActionId?: "global-selected-text-lookup" | KeyboardShortcutActionId;
  bindings: readonly ShortcutBinding[];
};

export type ShortcutGroup = {
  id: string;
  label: string;
  actions: readonly ShortcutAction[];
};

function editableBinding(shortcut: KeyboardBinding): ShortcutBinding {
  return { tokens: shortcutTokens(shortcut), editable: true, shortcut };
}

export function shortcutGroups(
  globalLookupSettings?: GlobalLookupSettings | null,
  keyboardShortcutSettings: KeyboardShortcutSettings = defaultKeyboardShortcutSettings,
): readonly ShortcutGroup[] {
  const globalLookup = globalLookupSettings ?? {
    enabled: false,
    shortcut: defaultGlobalLookupShortcut,
  };
  const keyboard = resolvedKeyboardShortcutBindings(keyboardShortcutSettings);

  return [
    {
      id: "global",
      label: "Global",
      actions: [
        {
          id: "global-selected-text-lookup",
          label: "Look up selected text",
          detail: globalLookup.enabled
            ? "Works in Windows apps that expose selected text through UI Automation."
            : "Disabled in Advanced settings.",
          editableActionId: "global-selected-text-lookup",
          bindings: [editableBinding(globalLookup.shortcut)],
        },
      ],
    },
    {
      id: "reader",
      label: "Reader",
      actions: [
        {
          id: "reader-next-page",
          label: "Next page",
          editableActionId: "reader-next-page",
          bindings: [editableBinding(keyboard["reader-next-page"]), { tokens: ["Wheel down"] }],
        },
        {
          id: "reader-previous-page",
          label: "Previous page",
          editableActionId: "reader-previous-page",
          bindings: [editableBinding(keyboard["reader-previous-page"]), { tokens: ["Wheel up"] }],
        },
        {
          id: "reader-next-chapter",
          label: "Next chapter",
          editableActionId: "reader-next-chapter",
          bindings: [editableBinding(keyboard["reader-next-chapter"]), { tokens: ["Ctrl", "Wheel down"] }],
        },
        {
          id: "reader-previous-chapter",
          label: "Previous chapter",
          editableActionId: "reader-previous-chapter",
          bindings: [editableBinding(keyboard["reader-previous-chapter"]), { tokens: ["Ctrl", "Wheel up"] }],
        },
        {
          id: "reader-pointer-lookup",
          label: "Look up text at pointer",
          detail: "Hold Shift while hovering over reader text.",
          bindings: [{ tokens: ["Shift", "Hover"] }],
        },
        {
          id: "reader-click-lookup",
          label: "Look up selected text",
          detail: "Click or select reader text.",
          bindings: [{ tokens: ["Click"] }],
        },
        {
          id: "reader-close",
          label: "Close reader / clear selection",
          detail: "Clears active selection first, otherwise returns to Library.",
          editableActionId: "reader-close",
          bindings: [editableBinding(keyboard["reader-close"])],
        },
      ],
    },
    {
      id: "sasayaki",
      label: "Sasayaki",
      actions: [
        {
          id: "sasayaki-toggle-playback",
          label: "Toggle playback",
          detail: "When Sasayaki audio is available in the reader.",
          editableActionId: "sasayaki-toggle-playback",
          bindings: [editableBinding(keyboard["sasayaki-toggle-playback"])],
        },
        {
          id: "sasayaki-previous-skip-action",
          label: "Skip backward",
          detail: "Uses the current Sasayaki skip action.",
          editableActionId: "sasayaki-previous-skip-action",
          bindings: [editableBinding(keyboard["sasayaki-previous-skip-action"])],
        },
        {
          id: "sasayaki-next-skip-action",
          label: "Skip forward",
          detail: "Uses the current Sasayaki skip action.",
          editableActionId: "sasayaki-next-skip-action",
          bindings: [editableBinding(keyboard["sasayaki-next-skip-action"])],
        },
      ],
    },
  ];
}
