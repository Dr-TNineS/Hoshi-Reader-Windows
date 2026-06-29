<script lang="ts">
  import {
    formatReadingSpeed,
    formatStatisticsDuration,
    secondsRemaining,
    type ReaderStatisticsState,
    type ReadingStatistic,
  } from "./reading-statistics";

  let {
    state,
    currentCharacter = 0,
    currentChapterEndCharacter = 0,
    totalCharacters = 0,
    onToggleTracking,
    onClose,
  }: {
    state: ReaderStatisticsState;
    currentCharacter?: number;
    currentChapterEndCharacter?: number;
    totalCharacters?: number;
    onToggleTracking: () => void;
    onClose: () => void;
  } = $props();

  function rows(statistic: ReadingStatistic, extraRows: Array<[string, string]> = []) {
    return [
      ["Characters read", statistic.charactersRead.toLocaleString()],
      ["Reading speed", formatReadingSpeed(statistic.lastReadingSpeed)],
      ["Reading time", formatStatisticsDuration(statistic.readingTime)],
      ...extraRows,
    ];
  }

  const sessionExtraRows = $derived([
    ["Time to finish book", formatStatisticsDuration(secondsRemaining(totalCharacters - currentCharacter, state.session.lastReadingSpeed))],
    ["Time to finish chapter", formatStatisticsDuration(secondsRemaining(currentChapterEndCharacter - currentCharacter, state.session.lastReadingSpeed))],
  ] satisfies Array<[string, string]>);
</script>

<div class="statistics-backdrop" role="presentation" onclick={onClose}></div>
<aside id="reader-statistics" class="statistics-panel" aria-label="Reading statistics">
  <section class="statistics-section">
    <div class="section-head">
      <h2>Session</h2>
      <button class="tracking-toggle" onclick={onToggleTracking}>
        {state.isTracking ? "Pause" : "Start"}
      </button>
    </div>
    <div class="stat-card">
      {#each rows(state.session, sessionExtraRows) as [label, value]}
        <div class="stat-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      {/each}
    </div>
  </section>

  <section class="statistics-section">
    <h2>Today</h2>
    <div class="stat-card">
      {#each rows(state.today) as [label, value]}
        <div class="stat-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      {/each}
    </div>
  </section>

  <section class="statistics-section">
    <h2>All Time</h2>
    <div class="stat-card">
      {#each rows(state.allTime) as [label, value]}
        <div class="stat-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      {/each}
    </div>
  </section>
</aside>

<style>
  .statistics-backdrop {
    position: fixed;
    inset: 0 0 70% 0;
    z-index: 110;
    background: transparent;
  }
  .statistics-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 111;
    height: 70vh;
    min-height: 260px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    padding: 16px 20px 26px;
    background: var(--app-surface);
    color: var(--app-text);
    border-top: 1px solid var(--app-border);
    box-shadow: 0 -18px 40px color-mix(in srgb, #000 22%, transparent);
  }
  .statistics-section { display: flex; flex-direction: column; gap: 8px; }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 {
    color: var(--app-muted);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .tracking-toggle {
    min-width: 76px;
    min-height: 30px;
    padding: 5px 12px;
    background: var(--app-control);
    color: var(--app-text);
    border: 1px solid var(--app-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 650;
  }
  .tracking-toggle:hover { background: var(--app-control-hover); }
  .stat-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--app-bg);
    border: 1px solid var(--app-border);
    border-radius: 8px;
  }
  .stat-row {
    min-height: 38px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 8px 14px;
    border-top: 1px solid var(--app-border);
    font-size: 13px;
  }
  .stat-row:first-child { border-top: none; }
  .stat-row span { color: var(--app-text); }
  .stat-row strong {
    color: var(--app-text);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media (max-width: 560px) {
    .statistics-panel { padding-inline: 14px; }
    .stat-row { grid-template-columns: 1fr; gap: 3px; align-items: start; }
    .stat-row strong { white-space: normal; }
  }
</style>
