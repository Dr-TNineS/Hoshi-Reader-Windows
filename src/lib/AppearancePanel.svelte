<script lang="ts">
  import {
    readerAppearanceColorLabels,
    readerInterfaceLabels,
    type ReaderAppearance,
    type ReaderAppearanceColorField,
    type ReaderInterfaceTheme,
    type ReaderTheme,
  } from "./appearance";
  import { LOOKUP_POPUP_HEIGHT, LOOKUP_POPUP_SCALE, LOOKUP_POPUP_WIDTH, type LookupPopupSettings } from "./lookup-popup-settings";
  import UiToggleGroup from "./ui/ToggleGroup.svelte";

  let {
    appearance,
    themeLabels,
    onThemeChange,
    onInterfaceChange,
    onAppearanceColorChange,
    popupSettings,
    onPopupWidthChange,
    onPopupHeightChange,
    onPopupScaleChange,
  }: {
    appearance: ReaderAppearance;
    themeLabels: Record<ReaderTheme, string>;
    onThemeChange: (theme: ReaderTheme) => void;
    onInterfaceChange: (theme: ReaderInterfaceTheme) => void;
    onAppearanceColorChange: (field: ReaderAppearanceColorField, color: string) => void;
    popupSettings: LookupPopupSettings;
    onPopupWidthChange: (width: number) => void;
    onPopupHeightChange: (height: number) => void;
    onPopupScaleChange: (scale: number) => void;
  } = $props();

  const themeOptions = $derived(
    (Object.keys(themeLabels) as ReaderTheme[]).map((theme) => ({ value: theme, label: themeLabels[theme] })),
  );
  const interfaceOptions = $derived(
    (Object.keys(readerInterfaceLabels) as ReaderInterfaceTheme[]).map((theme) => ({ value: theme, label: readerInterfaceLabels[theme] })),
  );
  const readerColorRows: { field: ReaderAppearanceColorField; label: string; ariaLabel: string }[] = [
    { field: "customBackgroundColor", label: readerAppearanceColorLabels.customBackgroundColor, ariaLabel: "Reader background" },
    { field: "customTextColor", label: readerAppearanceColorLabels.customTextColor, ariaLabel: "Reader text" },
    { field: "customInfoColor", label: readerAppearanceColorLabels.customInfoColor, ariaLabel: "Reader info" },
  ];
  const sasayakiLightColorRows: { field: ReaderAppearanceColorField; label: string; ariaLabel: string }[] = [
    { field: "sasayakiLightTextColor", label: readerAppearanceColorLabels.sasayakiLightTextColor, ariaLabel: "Sasayaki light text" },
    { field: "sasayakiLightBackgroundColor", label: readerAppearanceColorLabels.sasayakiLightBackgroundColor, ariaLabel: "Sasayaki light background" },
  ];
  const sasayakiDarkColorRows: { field: ReaderAppearanceColorField; label: string; ariaLabel: string }[] = [
    { field: "sasayakiDarkTextColor", label: readerAppearanceColorLabels.sasayakiDarkTextColor, ariaLabel: "Sasayaki dark text" },
    { field: "sasayakiDarkBackgroundColor", label: readerAppearanceColorLabels.sasayakiDarkBackgroundColor, ariaLabel: "Sasayaki dark background" },
  ];

  function setTheme(theme: string) {
    if (theme === "light" || theme === "dark" || theme === "sepia" || theme === "custom") onThemeChange(theme);
  }

  function setInterface(theme: string) {
    if (theme === "system" || theme === "light" || theme === "dark") onInterfaceChange(theme);
  }

  function commitColor(field: ReaderAppearanceColorField, color: string) {
    onAppearanceColorChange(field, color);
  }
</script>

<section class="appearance-panel" aria-label="Reader appearance">
  <div class="appearance-head">
    <h2>Appearance</h2>
    <p class="appearance-summary">HSA reader themes with optional custom reader and Sasayaki colors.</p>
  </div>
  <UiToggleGroup value={appearance.theme} items={themeOptions} ariaLabel="Theme" onValueChange={setTheme} />
  {#if appearance.theme === "custom"}
    <div class="custom-settings" aria-label="Custom reader appearance">
      <div class="setting-row">
        <span class="setting-label">Interface</span>
        <UiToggleGroup value={appearance.interface} items={interfaceOptions} ariaLabel="Interface" onValueChange={setInterface} />
      </div>
      <div class="color-section">
        <h3>Reader</h3>
        {#each readerColorRows as row}
          <label class="color-row">
            <span>{row.label}</span>
            <span class="color-controls">
              <span class="color-swatch" style={`background:${appearance[row.field]}`} aria-hidden="true"></span>
              <input aria-label={`${row.ariaLabel} picker`} class="native-color" type="color" value={appearance[row.field]} oninput={(event) => commitColor(row.field, event.currentTarget.value)} />
              <input aria-label={`${row.ariaLabel} color`} class="hex-input" value={appearance[row.field]} maxlength="7" pattern="#[0-9a-fA-F]{6}" onchange={(event) => commitColor(row.field, event.currentTarget.value)} />
            </span>
          </label>
        {/each}
      </div>
      <div class="color-section">
        <h3>Sasayaki Light</h3>
        {#each sasayakiLightColorRows as row}
          <label class="color-row">
            <span>{row.label}</span>
            <span class="color-controls">
              <span class="color-swatch" style={`background:${appearance[row.field]}`} aria-hidden="true"></span>
              <input aria-label={`${row.ariaLabel} picker`} class="native-color" type="color" value={appearance[row.field]} oninput={(event) => commitColor(row.field, event.currentTarget.value)} />
              <input aria-label={`${row.ariaLabel} color`} class="hex-input" value={appearance[row.field]} maxlength="7" pattern="#[0-9a-fA-F]{6}" onchange={(event) => commitColor(row.field, event.currentTarget.value)} />
            </span>
          </label>
        {/each}
      </div>
      <div class="color-section">
        <h3>Sasayaki Dark</h3>
        {#each sasayakiDarkColorRows as row}
          <label class="color-row">
            <span>{row.label}</span>
            <span class="color-controls">
              <span class="color-swatch" style={`background:${appearance[row.field]}`} aria-hidden="true"></span>
              <input aria-label={`${row.ariaLabel} picker`} class="native-color" type="color" value={appearance[row.field]} oninput={(event) => commitColor(row.field, event.currentTarget.value)} />
              <input aria-label={`${row.ariaLabel} color`} class="hex-input" value={appearance[row.field]} maxlength="7" pattern="#[0-9a-fA-F]{6}" onchange={(event) => commitColor(row.field, event.currentTarget.value)} />
            </span>
          </label>
        {/each}
      </div>
    </div>
  {/if}
  <div class="popup-settings" aria-label="Dictionary popup settings">
    <h3>Dictionary Popup</h3>
    <label>
      <span>Width <strong>{popupSettings.width}</strong></span>
      <input aria-label="Popup width" type="range" min={LOOKUP_POPUP_WIDTH.min} max={LOOKUP_POPUP_WIDTH.max} step={LOOKUP_POPUP_WIDTH.step} value={popupSettings.width} oninput={(event) => onPopupWidthChange(event.currentTarget.valueAsNumber)} />
    </label>
    <label>
      <span>Height <strong>{popupSettings.height}</strong></span>
      <input aria-label="Popup height" type="range" min={LOOKUP_POPUP_HEIGHT.min} max={LOOKUP_POPUP_HEIGHT.max} step={LOOKUP_POPUP_HEIGHT.step} value={popupSettings.height} oninput={(event) => onPopupHeightChange(event.currentTarget.valueAsNumber)} />
    </label>
    <label>
      <span>Scale <strong>{popupSettings.scale.toFixed(2)}</strong></span>
      <input aria-label="Popup scale" type="range" min={LOOKUP_POPUP_SCALE.min} max={LOOKUP_POPUP_SCALE.max} step={LOOKUP_POPUP_SCALE.step} value={popupSettings.scale} oninput={(event) => onPopupScaleChange(event.currentTarget.valueAsNumber)} />
    </label>
  </div>
</section>

<style>
  h2 { font-size: 13px; font-weight: 600; color: var(--app-muted); text-transform: uppercase; }
  .appearance-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 12px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }
  .appearance-summary { margin-top: 4px; color: var(--app-muted); font-size: 12px; line-height: 1.35; }
  .custom-settings { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 12px; border-top: 1px solid var(--app-border); }
  .setting-row { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .setting-label { color: var(--app-text); font-size: 12px; font-weight: 600; }
  .color-section { min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; background: var(--app-bg); border: 1px solid var(--app-border); border-radius: 6px; }
  .color-row { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; color: var(--app-text); font-size: 12px; }
  .color-controls { display: grid; grid-template-columns: 18px 28px 82px; align-items: center; gap: 6px; }
  .color-swatch { width: 18px; height: 18px; border: 1px solid var(--app-border); border-radius: 50%; }
  .native-color { width: 28px; height: 24px; padding: 0; background: transparent; border: none; cursor: pointer; }
  .hex-input { width: 82px; min-width: 0; padding: 4px 6px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 4px; font: inherit; font-variant-numeric: tabular-nums; }
  .hex-input:focus-visible { outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color); outline-offset: var(--ui-focus-ring-offset); }
  .popup-settings { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 12px; border-top: 1px solid var(--app-border); }
  h3 { grid-column: 1 / -1; color: var(--app-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  label { display: flex; flex-direction: column; gap: 6px; color: var(--app-text); font-size: 12px; }
  label span { display: flex; justify-content: space-between; gap: 8px; }
  label strong { font-variant-numeric: tabular-nums; }
  input[type="range"] { width: 100%; accent-color: var(--app-primary); }
  @media (max-width: 640px) {
    .appearance-panel { grid-template-columns: 1fr; align-items: stretch; }
    .custom-settings { grid-template-columns: 1fr; }
    .setting-row { flex-direction: column; align-items: stretch; }
    .popup-settings { grid-template-columns: 1fr; }
  }
</style>
