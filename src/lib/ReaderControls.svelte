<script lang="ts">
  let {
    onPrevChapter,
    onNextChapter,
    onToggleToc,
    onBackToShelf,
    onToggleSasayaki = () => {},
    onToggleStatisticsPanel = () => {},
    onToggleStatisticsTracking = () => {},
    tocOpen = false,
    sasayakiOpen = false,
    sasayakiAvailable = false,
    statisticsOpen = false,
    statisticsEnabled = false,
    statisticsTracking = false,
    showStatisticsToggle = false,
    statisticsText = "",
  }: {
    onPrevChapter: () => void;
    onNextChapter: () => void;
    onToggleToc: () => void;
    onBackToShelf: () => void;
    onToggleSasayaki?: () => void;
    onToggleStatisticsPanel?: () => void;
    onToggleStatisticsTracking?: () => void;
    tocOpen?: boolean;
    sasayakiOpen?: boolean;
    sasayakiAvailable?: boolean;
    statisticsOpen?: boolean;
    statisticsEnabled?: boolean;
    statisticsTracking?: boolean;
    showStatisticsToggle?: boolean;
    statisticsText?: string;
  } = $props();
</script>

<div class="ctrls">
  <button onclick={onPrevChapter}>Prev Ch</button>
  <button onclick={onNextChapter}>Next Ch</button>
  <button
    id="reader-toc-trigger"
    aria-expanded={tocOpen}
    aria-controls="reader-toc"
    onclick={onToggleToc}
  >TOC</button>
  <button
    id="reader-sasayaki-trigger"
    aria-expanded={sasayakiOpen}
    aria-controls="sasayaki-player"
    class:available={sasayakiAvailable}
    onclick={onToggleSasayaki}
  >Audio</button>
  {#if statisticsEnabled}
    <button
      id="reader-statistics-trigger"
      aria-expanded={statisticsOpen}
      aria-controls="reader-statistics"
      class:available={statisticsTracking}
      onclick={onToggleStatisticsPanel}
    >Stats</button>
    {#if showStatisticsToggle}
      <button
        aria-label={statisticsTracking ? "Pause reading statistics" : "Start reading statistics"}
        class:available={statisticsTracking}
        onclick={onToggleStatisticsTracking}
      >{statisticsTracking ? "Pause" : "Start"}</button>
    {/if}
    {#if statisticsText}
      <span class="statistics-text">{statisticsText}</span>
    {/if}
  {/if}
  <button onclick={onBackToShelf}>Esc</button>
</div>

<style>
  .ctrls { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; background: var(--app-bg); border-top: 1px solid var(--app-border); z-index: 100; }
  .ctrls button { padding: 4px 10px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px; cursor: pointer; font-size: 12px; }
  .ctrls button:hover { background: var(--app-control-hover); }
  .ctrls button.available { border-color: var(--app-primary); }
  .statistics-text { max-width: min(34vw, 260px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  @media (max-width: 560px) {
    .ctrls { justify-content: flex-start; overflow-x: auto; }
    .ctrls button { flex: 0 0 auto; }
    .statistics-text { flex: 0 0 auto; max-width: 180px; }
  }
</style>
