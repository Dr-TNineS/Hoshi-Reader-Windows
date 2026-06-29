<script lang="ts">
  import AdvancedPanel from "./AdvancedPanel.svelte";
  import ShortcutsPanel from "./ShortcutsPanel.svelte";
  import {
    defaultGlobalLookupSettings,
    defaultGlobalLookupShortcut,
    type GlobalLookupSettings,
    type ShortcutBinding,
  } from "./global-lookup-settings";

  let advancedSettings = $state({ reopenLastBookOnStartup: true });
  let globalLookupSettings = $state<GlobalLookupSettings>({
    ...defaultGlobalLookupSettings,
    registration: { registered: true, error: null },
  });
  let events = $state<string[]>([]);

  function save(next: GlobalLookupSettings, event: string) {
    globalLookupSettings = next;
    events = [...events, event];
  }

  function setEnabled(enabled: boolean) {
    save({ ...globalLookupSettings, enabled, registration: { registered: enabled, error: null } }, `enabled:${enabled}`);
  }

  function setShortcut(shortcut: ShortcutBinding) {
    save({ ...globalLookupSettings, enabled: true, shortcut, registration: { registered: true, error: null } }, `shortcut:${shortcut.displayLabel}`);
  }

  function resetShortcut() {
    save({ ...globalLookupSettings, enabled: true, shortcut: defaultGlobalLookupShortcut, registration: { registered: true, error: null } }, "reset");
  }

  function simulateRegistrationError() {
    save({
      ...globalLookupSettings,
      registration: { registered: false, error: "Shortcut is already used." },
    }, "error");
  }
</script>

<main class="probe" data-ui-portal-root>
  <AdvancedPanel
    settings={advancedSettings}
    {globalLookupSettings}
    onReopenLastBookOnStartupChange={(enabled) => advancedSettings = { ...advancedSettings, reopenLastBookOnStartup: enabled }}
    onGlobalLookupEnabledChange={setEnabled}
    onGlobalLookupShortcutChange={setShortcut}
    onGlobalLookupShortcutReset={resetShortcut}
  />
  <ShortcutsPanel
    {globalLookupSettings}
    onGlobalLookupShortcutChange={setShortcut}
    onGlobalLookupShortcutReset={resetShortcut}
  />
  <div class="probe-controls">
    <button onclick={simulateRegistrationError}>registration error</button>
  </div>
  <div
    class="probe-state"
    data-enabled={globalLookupSettings.enabled}
    data-shortcut={globalLookupSettings.shortcut.displayLabel}
    data-registered={globalLookupSettings.registration.registered}
    data-error={globalLookupSettings.registration.error ?? ""}
    data-events={events.join("|")}
    aria-hidden="true"
  ></div>
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { overflow: auto; font-family: "Segoe UI", sans-serif; }
  .probe {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px;
    --app-bg: #000000;
    --app-text: #ffffff;
    --app-muted: #999999;
    --app-surface: #121212;
    --app-surface-hover: #1d1d1d;
    --app-border: #333333;
    --app-control: #1b1b1b;
    --app-control-hover: #262626;
    --app-primary: #d0bcff;
    --app-primary-hover: #c1a9fb;
    --app-error: #ffb4ab;
    --app-status: #cce8d5;
    --app-shadow: rgba(0, 0, 0, 0.48);
    background: var(--app-bg);
    color: var(--app-text);
  }
  .probe-controls { position: fixed; right: 8px; bottom: 8px; opacity: 0.01; }
  .probe-state { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
</style>
