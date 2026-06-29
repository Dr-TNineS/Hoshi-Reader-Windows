<script lang="ts">
  import type { AdvancedSettings } from "./advanced-settings";
  import { defaultReaderAppearance, normalizeReaderAppearance, type ReaderAppearance } from "./appearance";
  import AppearancePanel from "./AppearancePanel.svelte";
  import { normalizeDictionarySettings, type DictionarySettings } from "./dictionary-settings";
  import { normalizeLookupPopupSettings, type LookupPopupSettings } from "./lookup-popup-settings";
  import { createSettingsState, type SettingsPersistence } from "./state/settings.svelte";

  let savedAppearances = $state<ReaderAppearance[]>([]);
  let savedAdvancedSettings = $state<AdvancedSettings[]>([]);
  let savedLookupPopupSettings = $state<LookupPopupSettings[]>([]);
  let savedDictionarySettings = $state<DictionarySettings[]>([]);
  const normalizedInvalidPopupSettings = normalizeLookupPopupSettings({ width: Number.POSITIVE_INFINITY, height: -50, scale: "large" });
  const normalizedInvalidDictionarySettings = normalizeDictionarySettings({ maxResults: 999, scanLength: -10, compactGlossaries: false, compactPitchAccents: false });

  const persistence: SettingsPersistence = {
    loadReaderAppearance: () => normalizeReaderAppearance({
      ...defaultReaderAppearance,
      theme: "dark",
      interface: "light",
      customBackgroundColor: "invalid",
      customTextColor: "#ABCDEF",
    }),
    saveReaderAppearance: (appearance) => savedAppearances = [...savedAppearances, appearance],
    loadAdvancedSettings: () => ({
      reopenLastBookOnStartup: true,
      enableReadingStatistics: false,
      readingStatisticsAutostartMode: "off",
      showReadingStatisticsToggle: false,
    }),
    saveAdvancedSettings: (settings) => savedAdvancedSettings = [...savedAdvancedSettings, settings],
    loadLookupPopupSettings: () => ({ width: 320, height: 250, scale: 1 }),
    saveLookupPopupSettings: (settings) => savedLookupPopupSettings = [...savedLookupPopupSettings, settings],
    loadDictionarySettings: () => normalizeDictionarySettings({ maxResults: 12, scanLength: 24, harmonicFrequency: true }),
    saveDictionarySettings: (settings) => savedDictionarySettings = [...savedDictionarySettings, settings],
  };

  const settings = createSettingsState(persistence);
</script>

<main>
  <AppearancePanel
    appearance={settings.readerAppearance}
    themeLabels={{ light: "Light", dark: "Dark", sepia: "Sepia", custom: "Custom" }}
    onThemeChange={settings.setReaderTheme}
    onInterfaceChange={settings.setReaderInterface}
    onAppearanceColorChange={settings.setReaderAppearanceColor}
    popupSettings={settings.lookupPopupSettings}
    onPopupWidthChange={settings.setLookupPopupWidth}
    onPopupHeightChange={settings.setLookupPopupHeight}
    onPopupScaleChange={settings.setLookupPopupScale}
  />
  <button onclick={() => settings.setReopenLastBookOnStartup(!settings.advancedSettings.reopenLastBookOnStartup)}>
    Toggle startup
  </button>
  <button onclick={() => settings.updateAdvancedSettings({ enableReadingStatistics: true })}>
    Enable statistics
  </button>
  <button onclick={() => settings.updateAdvancedSettings({ readingStatisticsAutostartMode: "pageTurn" })}>
    Page turn statistics
  </button>
  <button onclick={() => settings.updateDictionarySettings({ maxResults: 88, scanLength: 0, compactGlossaries: false })}>
    Clamp dictionary
  </button>
  <div
    class="probe-state"
    data-theme={settings.readerAppearance.theme}
    data-interface={settings.readerAppearance.interface}
    data-system-dark={settings.systemDark}
    data-custom-background={settings.readerAppearance.customBackgroundColor}
    data-custom-text={settings.readerAppearance.customTextColor}
    data-custom-info={settings.readerAppearance.customInfoColor}
    data-sasayaki-light-text={settings.readerAppearance.sasayakiLightTextColor}
    data-sasayaki-light-background={settings.readerAppearance.sasayakiLightBackgroundColor}
    data-sasayaki-dark-text={settings.readerAppearance.sasayakiDarkTextColor}
    data-sasayaki-dark-background={settings.readerAppearance.sasayakiDarkBackgroundColor}
    data-reopen={settings.advancedSettings.reopenLastBookOnStartup}
    data-statistics-enabled={settings.advancedSettings.enableReadingStatistics}
    data-statistics-autostart={settings.advancedSettings.readingStatisticsAutostartMode}
    data-statistics-toggle={settings.advancedSettings.showReadingStatisticsToggle}
    data-appearance-vars={settings.appearanceVars}
    data-saved-appearances={savedAppearances.map((appearance) => appearance.theme).join(",")}
    data-saved-appearance-json={JSON.stringify(savedAppearances)}
    data-saved-advanced={savedAdvancedSettings.map((advanced) => `${advanced.reopenLastBookOnStartup}:${advanced.enableReadingStatistics}:${advanced.readingStatisticsAutostartMode}:${advanced.showReadingStatisticsToggle}`).join(",")}
    data-popup-width={settings.lookupPopupSettings.width}
    data-popup-height={settings.lookupPopupSettings.height}
    data-popup-scale={settings.lookupPopupSettings.scale}
    data-saved-popup={JSON.stringify(savedLookupPopupSettings)}
    data-normalized-invalid-popup={JSON.stringify(normalizedInvalidPopupSettings)}
    data-dictionary-max-results={settings.dictionarySettings.maxResults}
    data-dictionary-scan-length={settings.dictionarySettings.scanLength}
    data-dictionary-harmonic={settings.dictionarySettings.harmonicFrequency}
    data-dictionary-compact-glossaries={settings.dictionarySettings.compactGlossaries}
    data-saved-dictionary={JSON.stringify(savedDictionarySettings)}
    data-normalized-invalid-dictionary={JSON.stringify(normalizedInvalidDictionarySettings)}
  ></div>
</main>
