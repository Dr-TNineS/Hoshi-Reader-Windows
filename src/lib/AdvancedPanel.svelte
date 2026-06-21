<script lang="ts">
  import type { AdvancedSettings } from "./advanced-settings";
  import UiSwitch from "./ui/Switch.svelte";

  let {
    settings,
    onReopenLastBookOnStartupChange,
  }: {
    settings: AdvancedSettings;
    onReopenLastBookOnStartupChange: (enabled: boolean) => void;
  } = $props();
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
</section>

<style>
  .advanced-panel { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
  .advanced-summary { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
  .setting-card { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 14px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 8px; }
  .setting-copy { min-width: 0; }
  label { color: var(--app-text); font-size: 14px; font-weight: 600; line-height: 1.35; cursor: pointer; }
  .setting-copy p { margin-top: 4px; color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  @media (max-width: 640px) {
    .setting-card { align-items: flex-start; gap: 16px; }
  }
</style>
