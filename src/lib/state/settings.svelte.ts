import {
  loadAdvancedSettings,
  saveAdvancedSettings,
  type AdvancedSettings,
} from "../advanced-settings";
import {
  loadReaderAppearance,
  readerAppearanceCssVars,
  readerAppearancePalette,
  saveReaderAppearance,
  normalizeReaderAppearance,
  normalizeHexColor,
  type ReaderAppearance,
  type ReaderAppearanceColorField,
  type ReaderInterfaceTheme,
  type ReaderTheme,
} from "../appearance";
import {
  loadLookupPopupSettings,
  normalizeLookupPopupSettings,
  saveLookupPopupSettings,
  type LookupPopupSettings,
} from "../lookup-popup-settings";
import {
  loadDictionarySettings,
  normalizeDictionarySettings,
  saveDictionarySettings,
  type DictionarySettings,
} from "../dictionary-settings";
import type { ShortcutBinding } from "../global-lookup-settings";
import {
  conflictingKeyboardShortcutAction,
  defaultKeyboardShortcutBindings,
  defaultKeyboardShortcutSettings,
  loadKeyboardShortcutSettings,
  normalizeKeyboardShortcutSettings,
  saveKeyboardShortcutSettings,
  type KeyboardShortcutActionId,
  type KeyboardShortcutSettings,
} from "../keyboard-shortcuts";

export type SettingsPersistence = {
  loadReaderAppearance: () => ReaderAppearance;
  saveReaderAppearance: (appearance: ReaderAppearance) => void;
  loadAdvancedSettings: () => AdvancedSettings;
  saveAdvancedSettings: (settings: AdvancedSettings) => void;
  loadLookupPopupSettings: () => LookupPopupSettings;
  saveLookupPopupSettings: (settings: LookupPopupSettings) => void;
  loadDictionarySettings: () => DictionarySettings;
  saveDictionarySettings: (settings: DictionarySettings) => void;
  loadKeyboardShortcutSettings?: () => KeyboardShortcutSettings;
  saveKeyboardShortcutSettings?: (settings: KeyboardShortcutSettings) => void;
};

const browserSettingsPersistence: SettingsPersistence = {
  loadReaderAppearance,
  saveReaderAppearance,
  loadAdvancedSettings,
  saveAdvancedSettings,
  loadLookupPopupSettings,
  saveLookupPopupSettings,
  loadDictionarySettings,
  saveDictionarySettings,
  loadKeyboardShortcutSettings,
  saveKeyboardShortcutSettings,
};

export function createSettingsState(persistence: SettingsPersistence = browserSettingsPersistence) {
  const initialReaderAppearance = normalizeReaderAppearance(persistence.loadReaderAppearance());
  let readerAppearance = $state<ReaderAppearance>(initialReaderAppearance);
  let systemDark = $state(false);
  let advancedSettings = $state<AdvancedSettings>(persistence.loadAdvancedSettings());
  let lookupPopupSettings = $state<LookupPopupSettings>(persistence.loadLookupPopupSettings());
  let dictionarySettings = $state<DictionarySettings>(persistence.loadDictionarySettings());
  let keyboardShortcutSettings = $state<KeyboardShortcutSettings>(
    normalizeKeyboardShortcutSettings(persistence.loadKeyboardShortcutSettings?.() ?? defaultKeyboardShortcutSettings),
  );
  let appearancePalette = $derived(readerAppearancePalette(readerAppearance, systemDark));
  let appearanceVars = $derived(readerAppearanceCssVars(appearancePalette));

  // Preserve the existing startup normalization behavior from App.svelte.
  persistence.saveReaderAppearance(initialReaderAppearance);

  $effect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      systemDark = media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });

  function updateReaderAppearance(update: Partial<ReaderAppearance>) {
    readerAppearance = normalizeReaderAppearance({ ...readerAppearance, ...update });
    persistence.saveReaderAppearance(readerAppearance);
  }

  function setReaderTheme(theme: ReaderTheme) {
    updateReaderAppearance({ theme });
  }

  function setReaderInterface(theme: ReaderInterfaceTheme) {
    updateReaderAppearance({ interface: theme });
  }

  function setReaderAppearanceColor(field: ReaderAppearanceColorField, color: string) {
    updateReaderAppearance({ [field]: normalizeHexColor(color, readerAppearance[field]) });
  }

  function setReopenLastBookOnStartup(enabled: boolean) {
    advancedSettings = { ...advancedSettings, reopenLastBookOnStartup: enabled };
    persistence.saveAdvancedSettings(advancedSettings);
  }

  function updateLookupPopupSettings(update: Partial<LookupPopupSettings>) {
    lookupPopupSettings = normalizeLookupPopupSettings({ ...lookupPopupSettings, ...update });
    persistence.saveLookupPopupSettings(lookupPopupSettings);
  }

  function setLookupPopupWidth(width: number) {
    updateLookupPopupSettings({ width });
  }

  function setLookupPopupHeight(height: number) {
    updateLookupPopupSettings({ height });
  }

  function setLookupPopupScale(scale: number) {
    updateLookupPopupSettings({ scale });
  }

  function updateDictionarySettings(update: Partial<DictionarySettings>) {
    dictionarySettings = normalizeDictionarySettings({ ...dictionarySettings, ...update });
    persistence.saveDictionarySettings(dictionarySettings);
  }

  function setKeyboardShortcut(actionId: KeyboardShortcutActionId, shortcut: ShortcutBinding): string {
    const conflict = conflictingKeyboardShortcutAction(keyboardShortcutSettings, actionId, shortcut);
    if (conflict) return conflict;
    keyboardShortcutSettings = normalizeKeyboardShortcutSettings({
      ...keyboardShortcutSettings,
      bindings: { ...keyboardShortcutSettings.bindings, [actionId]: shortcut },
    });
    persistence.saveKeyboardShortcutSettings?.(keyboardShortcutSettings);
    return "";
  }

  function resetKeyboardShortcut(actionId: KeyboardShortcutActionId): string {
    const conflict = conflictingKeyboardShortcutAction(
      keyboardShortcutSettings,
      actionId,
      defaultKeyboardShortcutBindings[actionId],
    );
    if (conflict) return conflict;
    const bindings = { ...keyboardShortcutSettings.bindings };
    delete bindings[actionId];
    keyboardShortcutSettings = { version: 1, bindings };
    persistence.saveKeyboardShortcutSettings?.(keyboardShortcutSettings);
    return "";
  }

  return {
    get readerAppearance() { return readerAppearance; },
    get advancedSettings() { return advancedSettings; },
    get lookupPopupSettings() { return lookupPopupSettings; },
    get dictionarySettings() { return dictionarySettings; },
    get keyboardShortcutSettings() { return keyboardShortcutSettings; },
    get appearancePalette() { return appearancePalette; },
    get appearanceVars() { return appearanceVars; },
    get systemDark() { return systemDark; },
    setReaderTheme,
    setReaderInterface,
    setReaderAppearanceColor,
    setReopenLastBookOnStartup,
    setLookupPopupWidth,
    setLookupPopupHeight,
    setLookupPopupScale,
    updateDictionarySettings,
    setKeyboardShortcut,
    resetKeyboardShortcut,
  };
}

export type SettingsState = ReturnType<typeof createSettingsState>;
