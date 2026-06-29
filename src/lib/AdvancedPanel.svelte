<script lang="ts">
  import type { AdvancedSettings } from "./advanced-settings";
  import GlobalShortcutEditor from "./GlobalShortcutEditor.svelte";
  import { defaultGlobalLookupShortcut, type GlobalLookupSettings, type ShortcutBinding } from "./global-lookup-settings";
  import UiSwitch from "./ui/Switch.svelte";

  let {
    settings,
    globalLookupSettings,
    onReopenLastBookOnStartupChange,
    onGlobalLookupEnabledChange = (_enabled: boolean) => {},
    onGlobalLookupShortcutChange = (_shortcut: ShortcutBinding) => {},
    onGlobalLookupShortcutReset = () => {},
  }: {
    settings: AdvancedSettings;
    globalLookupSettings: GlobalLookupSettings;
    onReopenLastBookOnStartupChange: (enabled: boolean) => void;
    onGlobalLookupEnabledChange?: (enabled: boolean) => void;
    onGlobalLookupShortcutChange?: (shortcut: ShortcutBinding) => void;
    onGlobalLookupShortcutReset?: () => void;
  } = $props();

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
  label { color: var(--app-text); font-size: 14px; font-weight: 600; line-height: 1.35; cursor: pointer; }
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
