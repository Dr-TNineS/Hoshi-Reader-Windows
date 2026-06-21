<script lang="ts">
  import type { ReaderAppearance, ReaderTheme } from "./appearance";
  import UiToggleGroup from "./ui/ToggleGroup.svelte";

  let {
    appearance,
    themeLabels,
    onThemeChange,
  }: {
    appearance: ReaderAppearance;
    themeLabels: Record<ReaderTheme, string>;
    onThemeChange: (theme: ReaderTheme) => void;
  } = $props();

  const themeOptions = $derived(
    (Object.keys(themeLabels) as ReaderTheme[]).map((theme) => ({ value: theme, label: themeLabels[theme] })),
  );

  function setTheme(theme: string) {
    if (theme === "light" || theme === "dark") onThemeChange(theme);
  }
</script>

<section class="appearance-panel" aria-label="Reader appearance">
  <div>
    <h2>Appearance</h2>
    <p class="appearance-summary">HSA reader theme: white/black for Light, black/white for Dark.</p>
  </div>
  <UiToggleGroup value={appearance.theme} items={themeOptions} ariaLabel="Theme" onValueChange={setTheme} />
</section>

<style>
  h2 { font-size: 13px; font-weight: 600; color: var(--app-muted); text-transform: uppercase; }
  .appearance-panel { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }
  .appearance-summary { margin-top: 4px; color: var(--app-muted); font-size: 12px; line-height: 1.35; }
  @media (max-width: 640px) {
    .appearance-panel { align-items: stretch; flex-direction: column; }
  }
</style>
