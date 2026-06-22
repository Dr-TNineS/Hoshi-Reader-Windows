<script lang="ts">
  import type { AdvancedSettings } from "./advanced-settings";
  import type { ReaderAppearance } from "./appearance";
  import AppearancePanel from "./AppearancePanel.svelte";
  import { normalizeLookupPopupSettings, type LookupPopupSettings } from "./lookup-popup-settings";
  import { createSettingsState, type SettingsPersistence } from "./state/settings.svelte";

  let savedAppearances = $state<ReaderAppearance[]>([]);
  let savedAdvancedSettings = $state<AdvancedSettings[]>([]);
  let savedLookupPopupSettings = $state<LookupPopupSettings[]>([]);
  const normalizedInvalidPopupSettings = normalizeLookupPopupSettings({ width: Number.POSITIVE_INFINITY, height: -50, scale: "large" });

  const persistence: SettingsPersistence = {
    loadReaderAppearance: () => ({ theme: "dark" }),
    saveReaderAppearance: (appearance) => savedAppearances = [...savedAppearances, appearance],
    loadAdvancedSettings: () => ({ reopenLastBookOnStartup: true }),
    saveAdvancedSettings: (settings) => savedAdvancedSettings = [...savedAdvancedSettings, settings],
    loadLookupPopupSettings: () => ({ width: 320, height: 250, scale: 1 }),
    saveLookupPopupSettings: (settings) => savedLookupPopupSettings = [...savedLookupPopupSettings, settings],
  };

  const settings = createSettingsState(persistence);
</script>

<main>
  <AppearancePanel
    appearance={settings.readerAppearance}
    themeLabels={{ light: "Light", dark: "Dark" }}
    onThemeChange={settings.setReaderTheme}
    popupSettings={settings.lookupPopupSettings}
    onPopupWidthChange={settings.setLookupPopupWidth}
    onPopupHeightChange={settings.setLookupPopupHeight}
    onPopupScaleChange={settings.setLookupPopupScale}
  />
  <button onclick={() => settings.setReopenLastBookOnStartup(!settings.advancedSettings.reopenLastBookOnStartup)}>
    Toggle startup
  </button>
  <div
    class="probe-state"
    data-theme={settings.readerAppearance.theme}
    data-reopen={settings.advancedSettings.reopenLastBookOnStartup}
    data-appearance-vars={settings.appearanceVars}
    data-saved-appearances={savedAppearances.map((appearance) => appearance.theme).join(",")}
    data-saved-advanced={savedAdvancedSettings.map((advanced) => advanced.reopenLastBookOnStartup).join(",")}
    data-popup-width={settings.lookupPopupSettings.width}
    data-popup-height={settings.lookupPopupSettings.height}
    data-popup-scale={settings.lookupPopupSettings.scale}
    data-saved-popup={JSON.stringify(savedLookupPopupSettings)}
    data-normalized-invalid-popup={JSON.stringify(normalizedInvalidPopupSettings)}
  ></div>
</main>
