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
  type ReaderAppearance,
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

export type SettingsPersistence = {
  loadReaderAppearance: () => ReaderAppearance;
  saveReaderAppearance: (appearance: ReaderAppearance) => void;
  loadAdvancedSettings: () => AdvancedSettings;
  saveAdvancedSettings: (settings: AdvancedSettings) => void;
  loadLookupPopupSettings: () => LookupPopupSettings;
  saveLookupPopupSettings: (settings: LookupPopupSettings) => void;
  loadDictionarySettings: () => DictionarySettings;
  saveDictionarySettings: (settings: DictionarySettings) => void;
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
};

export function createSettingsState(persistence: SettingsPersistence = browserSettingsPersistence) {
  const initialReaderAppearance = persistence.loadReaderAppearance();
  let readerAppearance = $state<ReaderAppearance>(initialReaderAppearance);
  let advancedSettings = $state<AdvancedSettings>(persistence.loadAdvancedSettings());
  let lookupPopupSettings = $state<LookupPopupSettings>(persistence.loadLookupPopupSettings());
  let dictionarySettings = $state<DictionarySettings>(persistence.loadDictionarySettings());
  let appearancePalette = $derived(readerAppearancePalette(readerAppearance));
  let appearanceVars = $derived(readerAppearanceCssVars(appearancePalette));

  // Preserve the existing startup normalization behavior from App.svelte.
  persistence.saveReaderAppearance(initialReaderAppearance);

  function setReaderTheme(theme: ReaderTheme) {
    readerAppearance = { ...readerAppearance, theme };
    persistence.saveReaderAppearance(readerAppearance);
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

  return {
    get readerAppearance() { return readerAppearance; },
    get advancedSettings() { return advancedSettings; },
    get lookupPopupSettings() { return lookupPopupSettings; },
    get dictionarySettings() { return dictionarySettings; },
    get appearancePalette() { return appearancePalette; },
    get appearanceVars() { return appearanceVars; },
    setReaderTheme,
    setReopenLastBookOnStartup,
    setLookupPopupWidth,
    setLookupPopupHeight,
    setLookupPopupScale,
    updateDictionarySettings,
  };
}

export type SettingsState = ReturnType<typeof createSettingsState>;
