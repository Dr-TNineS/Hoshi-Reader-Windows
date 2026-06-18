<script lang="ts">
  import type { ReaderAppearance, ReaderTheme } from "./appearance";

  let {
    appearance,
    themeLabels,
    onThemeChange,
  }: {
    appearance: ReaderAppearance;
    themeLabels: Record<ReaderTheme, string>;
    onThemeChange: (theme: ReaderTheme) => void;
  } = $props();
</script>

<section class="appearance-panel" aria-label="Reader appearance">
  <div>
    <h2>Appearance</h2>
    <p class="appearance-summary">HSA reader theme: white/black for Light, black/white for Dark.</p>
  </div>
  <div class="theme-segments" role="group" aria-label="Theme">
    {#each (Object.keys(themeLabels) as ReaderTheme[]) as theme}
      <button
        class:active={appearance.theme === theme}
        aria-pressed={appearance.theme === theme}
        onclick={() => onThemeChange(theme)}
      >
        {themeLabels[theme]}
      </button>
    {/each}
  </div>
</section>

<style>
  h2 { font-size: 13px; font-weight: 600; color: var(--app-muted); text-transform: uppercase; }
  .appearance-panel { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }
  .appearance-summary { margin-top: 4px; color: var(--app-muted); font-size: 12px; line-height: 1.35; }
  .theme-segments { display: flex; align-items: center; gap: 4px; padding: 3px; background: var(--app-control); border: 1px solid var(--app-border); border-radius: 6px; }
  .theme-segments button { min-width: 72px; padding: 6px 12px; background: transparent; color: var(--app-text); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  .theme-segments button:hover { background: var(--app-control-hover); }
  .theme-segments button.active { background: var(--app-primary); color: var(--app-bg); }
  @media (max-width: 640px) {
    .appearance-panel { align-items: stretch; flex-direction: column; }
    .theme-segments button { flex: 1 1 0; }
  }
</style>
