import { defaultGlobalLookupShortcut, type GlobalLookupSettings } from "./global-lookup-settings";

export type ShortcutBinding = {
  tokens: readonly string[];
};

export type ShortcutAction = {
  id: string;
  label: string;
  detail?: string;
  bindings: readonly ShortcutBinding[];
};

export type ShortcutGroup = {
  id: string;
  label: string;
  actions: readonly ShortcutAction[];
};

const baseShortcutGroups: readonly ShortcutGroup[] = [
  {
    id: "reader",
    label: "Reader",
    actions: [
      {
        id: "next-page",
        label: "Next page",
        bindings: [{ tokens: ["←"] }, { tokens: ["Wheel down"] }],
      },
      {
        id: "previous-page",
        label: "Previous page",
        bindings: [{ tokens: ["→"] }, { tokens: ["Wheel up"] }],
      },
      {
        id: "next-chapter",
        label: "Next chapter",
        bindings: [{ tokens: ["Ctrl", "←"] }, { tokens: ["Ctrl", "Wheel down"] }],
      },
      {
        id: "previous-chapter",
        label: "Previous chapter",
        bindings: [{ tokens: ["Ctrl", "→"] }, { tokens: ["Ctrl", "Wheel up"] }],
      },
      {
        id: "lookup-at-pointer",
        label: "Look up text at pointer",
        detail: "Hold Shift while hovering over reader text.",
        bindings: [{ tokens: ["Shift", "Hover"] }],
      },
      {
        id: "clear-selection",
        label: "Clear selection and lookup",
        detail: "When a reader selection is active.",
        bindings: [{ tokens: ["Esc"] }],
      },
      {
        id: "return-to-library",
        label: "Return to Library",
        detail: "When no reader selection is active.",
        bindings: [{ tokens: ["Esc"] }],
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
        bindings: [{ tokens: ["P"] }],
      },
      {
        id: "sasayaki-previous-skip-action",
        label: "Skip backward",
        detail: "Uses the current Sasayaki skip action.",
        bindings: [{ tokens: ["["] }],
      },
      {
        id: "sasayaki-next-skip-action",
        label: "Skip forward",
        detail: "Uses the current Sasayaki skip action.",
        bindings: [{ tokens: ["]"] }],
      },
    ],
  },
];

export function shortcutGroups(globalLookupSettings?: GlobalLookupSettings | null): readonly ShortcutGroup[] {
  const globalLookup = globalLookupSettings ?? {
    enabled: true,
    shortcut: defaultGlobalLookupShortcut,
  };
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
          bindings: [{ tokens: globalLookup.shortcut.displayLabel.split("+").map((token) => token.trim()) }],
        },
      ],
    },
    ...baseShortcutGroups,
  ];
}
