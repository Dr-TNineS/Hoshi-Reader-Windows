<script lang="ts">
  import type { AdvancedSettings, ReadingStatisticsAutostartMode } from "./advanced-settings";
  import GlobalShortcutEditor from "./GlobalShortcutEditor.svelte";
  import { defaultGlobalLookupShortcut, type GlobalLookupSettings, type ShortcutBinding } from "./global-lookup-settings";
  import UiSelect from "./ui/Select.svelte";
  import UiSwitch from "./ui/Switch.svelte";

  let {
    settings,
    globalLookupSettings,
    onReopenLastBookOnStartupChange,
    onAdvancedSettingsChange,
    onGlobalLookupEnabledChange = (_enabled: boolean) => {},
    onGlobalLookupShortcutChange = (_shortcut: ShortcutBinding) => {},
    onGlobalLookupShortcutReset = () => {},
  }: {
    settings: AdvancedSettings;
    globalLookupSettings: GlobalLookupSettings;
    onReopenLastBookOnStartupChange: (enabled: boolean) => void;
    onAdvancedSettingsChange: (update: Partial<AdvancedSettings>) => void;
    onGlobalLookupEnabledChange?: (enabled: boolean) => void;
    onGlobalLookupShortcutChange?: (shortcut: ShortcutBinding) => void;
    onGlobalLookupShortcutReset?: () => void;
  } = $props();

  const autostartOptions: { value: ReadingStatisticsAutostartMode; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "pageTurn", label: "Page Turn" },
    { value: "on", label: "On" },
  ];
  const globalLookupUnavailable = $derived(
    globalLookupSettings.enabled && !globalLookupSettings.registration.registered,
  );
</script>

<section class="advanced-panel" aria-label="Advanced settings">
  <p class="advanced-summary">Startup and application behavior.</p>

  <div class="setting-card">
    <div class="setting-copy">
      <label for="reopen-last-book">Reopen last book on startup</label>
      <p>Automatically return to the last reading session when Hoshi Reader starts.</p>
    </div>
    <UiSwitch
      id="reopen-last-book"
      checked={settings.reopenLastBookOnStartup}
      onCheckedChange={onReopenLastBookOnStartupChange}
    />
  </div>

  <div class="setting-card">
    <div class="setting-copy">
      <label for="reading-statistics-enabled">Reading statistics</label>
      <p>Track local reading time and character speed while the reader is active.</p>
    </div>
    <UiSwitch
      id="reading-statistics-enabled"
      checked={settings.enableReadingStatistics}
      onCheckedChange={(enabled) => onAdvancedSettingsChange({ enableReadingStatistics: enabled })}
    />
  </div>

  {#if settings.enableReadingStatistics}
    <div class="setting-card">
      <div class="setting-copy">
        <span id="statistics-autostart-label" class="setting-title">Statistics autostart</span>
        <p>Choose when an active reading session starts counting.</p>
      </div>
      <div class="setting-control">
        <UiSelect
          value={settings.readingStatisticsAutostartMode}
          items={autostartOptions}
          ariaLabelledby="statistics-autostart-label"
          onValueChange={(value) => onAdvancedSettingsChange({ readingStatisticsAutostartMode: value as ReadingStatisticsAutostartMode })}
        />
      </div>
    </div>

    <div class="setting-card">
      <div class="setting-copy">
        <label for="reading-statistics-toggle">Reader statistics toggle</label>
        <p>Show a quick start and pause button in the reader controls.</p>
      </div>
      <UiSwitch
        id="reading-statistics-toggle"
        checked={settings.showReadingStatisticsToggle}
        onCheckedChange={(enabled) => onAdvancedSettingsChange({ showReadingStatisticsToggle: enabled })}
      />
    </div>

    <div class="setting-card">
      <div class="setting-copy">
        <label for="reading-speed-display">Reading speed display</label>
        <p>Show the current session reading speed in the reader controls.</p>
      </div>
      <UiSwitch
        id="reading-speed-display"
        checked={settings.showReadingSpeed}
        onCheckedChange={(enabled) => onAdvancedSettingsChange({ showReadingSpeed: enabled })}
      />
    </div>

    <div class="setting-card">
      <div class="setting-copy">
        <label for="reading-time-display">Reading time display</label>
        <p>Show the current session reading time in the reader controls.</p>
      </div>
      <UiSwitch
        id="reading-time-display"
        checked={settings.showReadingTime}
        onCheckedChange={(enabled) => onAdvancedSettingsChange({ showReadingTime: enabled })}
      />
    </div>
  {/if}

  <div class="setting-card global-lookup-card">
    <div class="setting-copy">
      <label for="global-selected-lookup">Global selected-text lookup</label>
      <p>Look up selected text from other Windows apps when the focused control exposes UI Automation selection.</p>
      {#if globalLookupSettings.registration.error}
        <p class="setting-error">{globalLookupSettings.registration.error}</p>
      {:else if globalLookupUnavailable}
        <p class="setting-error">Global lookup shortcut is not registered.</p>
      {/if}
    </div>
    <div class="global-lookup-controls">
      <UiSwitch
        id="global-selected-lookup"
        checked={globalLookupSettings.enabled}
        onCheckedChange={onGlobalLookupEnabledChange}
      />
      <GlobalShortcutEditor
        shortcut={globalLookupSettings.shortcut}
        defaultShortcut={defaultGlobalLookupShortcut}
        requireCommandModifier={true}
        recordLabel="Record Global selected-text lookup shortcut"
        resetLabel="Reset Global selected-text lookup shortcut"
        onShortcutChange={onGlobalLookupShortcutChange}
        onShortcutReset={onGlobalLookupShortcutReset}
      />
    </div>
  </div>
</section>

<style>
  .advanced-panel { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
  .advanced-summary { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
  .setting-card { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 8px; }
  .setting-copy { min-width: 0; }
  .setting-control { min-width: 148px; }
  label { color: var(--app-text); font-size: 14px; font-weight: 600; line-height: 1.35; cursor: pointer; }
  .setting-title { display: inline-block; color: var(--app-text); font-size: 14px; font-weight: 600; line-height: 1.35; }
  .setting-copy p { margin-top: 4px; color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  .global-lookup-card { align-items: flex-start; }
  .global-lookup-controls { flex: 0 0 auto; min-width: 260px; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 16px; }
  .setting-error { color: var(--app-error) !important; }
  @media (max-width: 640px) {
    .setting-card { align-items: flex-start; gap: 16px; }
    .global-lookup-card { flex-direction: column; }
    .global-lookup-controls { width: 100%; grid-template-columns: auto minmax(0, 1fr); }
  }
</style>
