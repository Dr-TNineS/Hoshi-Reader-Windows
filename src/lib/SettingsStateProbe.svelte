<script lang="ts">
  import type { AdvancedSettings } from "./advanced-settings";
  import type { ReaderAppearance } from "./appearance";
  import AppearancePanel from "./AppearancePanel.svelte";
  import { createSettingsState, type SettingsPersistence } from "./state/settings.svelte";

  let savedAppearances = $state<ReaderAppearance[]>([]);
  let savedAdvancedSettings = $state<AdvancedSettings[]>([]);

  const persistence: SettingsPersistence = {
    loadReaderAppearance: () => ({ theme: "dark" }),
    saveReaderAppearance: (appearance) => savedAppearances = [...savedAppearances, appearance],
    loadAdvancedSettings: () => ({ reopenLastBookOnStartup: true }),
    saveAdvancedSettings: (settings) => savedAdvancedSettings = [...savedAdvancedSettings, settings],
  };

  const settings = createSettingsState(persistence);
</script>

<main>
  <AppearancePanel
    appearance={settings.readerAppearance}
    themeLabels={{ light: "Light", dark: "Dark" }}
    onThemeChange={settings.setReaderTheme}
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
  ></div>
</main>
