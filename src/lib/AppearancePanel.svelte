<script lang="ts">
  import type { ReaderAppearance, ReaderTheme } from "./appearance";
  import { LOOKUP_POPUP_HEIGHT, LOOKUP_POPUP_SCALE, LOOKUP_POPUP_WIDTH, type LookupPopupSettings } from "./lookup-popup-settings";
  import UiToggleGroup from "./ui/ToggleGroup.svelte";

  let {
    appearance,
    themeLabels,
    onThemeChange,
    popupSettings,
    onPopupWidthChange,
    onPopupHeightChange,
    onPopupScaleChange,
  }: {
    appearance: ReaderAppearance;
    themeLabels: Record<ReaderTheme, string>;
    onThemeChange: (theme: ReaderTheme) => void;
    popupSettings: LookupPopupSettings;
    onPopupWidthChange: (width: number) => void;
    onPopupHeightChange: (height: number) => void;
    onPopupScaleChange: (scale: number) => void;
  } = $props();

  const themeOptions = $derived(
    (Object.keys(themeLabels) as ReaderTheme[]).map((theme) => ({ value: theme, label: themeLabels[theme] })),
  );

  function setTheme(theme: string) {
    if (theme === "light" || theme === "dark" || theme === "sepia") onThemeChange(theme);
  }
</script>

<section class="appearance-panel" aria-label="Reader appearance">
  <div class="appearance-head">
    <h2>Appearance</h2>
    <p class="appearance-summary">HSA reader themes: white Light, black Dark, and warm Sepia.</p>
  </div>
  <UiToggleGroup value={appearance.theme} items={themeOptions} ariaLabel="Theme" onValueChange={setTheme} />
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
  .popup-settings { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 12px; border-top: 1px solid var(--app-border); }
  h3 { grid-column: 1 / -1; color: var(--app-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  label { display: flex; flex-direction: column; gap: 6px; color: var(--app-text); font-size: 12px; }
  label span { display: flex; justify-content: space-between; gap: 8px; }
  label strong { font-variant-numeric: tabular-nums; }
  input[type="range"] { width: 100%; accent-color: var(--app-primary); }
  @media (max-width: 640px) {
    .appearance-panel { grid-template-columns: 1fr; align-items: stretch; }
    .popup-settings { grid-template-columns: 1fr; }
  }
</style>
