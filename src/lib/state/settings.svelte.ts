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

export type SettingsPersistence = {
  loadReaderAppearance: () => ReaderAppearance;
  saveReaderAppearance: (appearance: ReaderAppearance) => void;
  loadAdvancedSettings: () => AdvancedSettings;
  saveAdvancedSettings: (settings: AdvancedSettings) => void;
};

const browserSettingsPersistence: SettingsPersistence = {
  loadReaderAppearance,
  saveReaderAppearance,
  loadAdvancedSettings,
  saveAdvancedSettings,
};

export function createSettingsState(persistence: SettingsPersistence = browserSettingsPersistence) {
  const initialReaderAppearance = persistence.loadReaderAppearance();
  let readerAppearance = $state<ReaderAppearance>(initialReaderAppearance);
  let advancedSettings = $state<AdvancedSettings>(persistence.loadAdvancedSettings());
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

  return {
    get readerAppearance() { return readerAppearance; },
    get advancedSettings() { return advancedSettings; },
    get appearancePalette() { return appearancePalette; },
    get appearanceVars() { return appearanceVars; },
    setReaderTheme,
    setReopenLastBookOnStartup,
  };
}

export type SettingsState = ReturnType<typeof createSettingsState>;
