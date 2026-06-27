<script lang="ts">
  import type { SasayakiPlaybackSession, SasayakiSkipAction } from "./types";

  let {
    session,
    playing = false,
    currentTime = 0,
    duration = 0,
    error = "",
    onClose,
    onToggle,
    onSeek,
    onSkip,
    onRateChange,
    onDelayChange,
    onAutoScrollChange,
    onAutoPauseChange,
    onSkipActionChange,
    onSkipAction,
    onRelink,
  }: {
    session: SasayakiPlaybackSession;
    playing?: boolean;
    currentTime?: number;
    duration?: number;
    error?: string;
    onClose: () => void;
    onToggle: () => void;
    onSeek: (seconds: number) => void;
    onSkip: (seconds: number) => void;
    onRateChange: (rate: number) => void;
    onDelayChange: (delay: number) => void;
    onAutoScrollChange: (enabled: boolean) => void;
    onAutoPauseChange: (enabled: boolean) => void;
    onSkipActionChange: (action: SasayakiSkipAction) => void;
    onSkipAction: (direction: -1 | 1) => void;
    onRelink: () => void;
  } = $props();

  function timeLabel(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
  }

  function skipLabel(action: SasayakiSkipAction): string {
    if (action === "cue") return "sentence";
    return `${action.replace("seconds", "")} seconds`;
  }
</script>

<section class="player-panel" aria-label="Sasayaki playback">
  <header>
    <div>
      <strong>Sasayaki</strong>
      <span>{session.audioFileName ?? "No audiobook"}</span>
    </div>
    <button aria-label="Close Sasayaki playback" onclick={onClose}>Close</button>
  </header>

  {#if !session.configured}
    <p>This book has no Sasayaki audio and subtitles. Configure them from the bookshelf Audio panel.</p>
  {:else if !session.audioAvailable}
    <p>The linked audiobook is unavailable. Relink it to continue from {timeLabel(session.lastPosition)}.</p>
    <button class="primary" onclick={onRelink}>Relink audiobook</button>
  {:else}
    <div class="transport">
      <button aria-label={`Skip backward ${skipLabel(session.skipAction)}`} onclick={() => onSkipAction(-1)}>Previous</button>
      <button aria-label="Skip backward 10 seconds" onclick={() => onSkip(-10)}>-10s</button>
      <button class="primary" aria-label={playing ? "Pause Sasayaki" : "Play Sasayaki"} onclick={onToggle}>
        {playing ? "Pause" : "Play"}
      </button>
      <button aria-label="Skip forward 10 seconds" onclick={() => onSkip(10)}>+10s</button>
      <button aria-label={`Skip forward ${skipLabel(session.skipAction)}`} onclick={() => onSkipAction(1)}>Next</button>
    </div>
    <div class="timeline">
      <span>{timeLabel(currentTime)}</span>
      <input
        aria-label="Sasayaki playback position"
        type="range"
        min="0"
        max={Math.max(duration, 0.01)}
        step="0.05"
        value={Math.min(currentTime, Math.max(duration, 0.01))}
        oninput={(event) => onSeek(Number(event.currentTarget.value))}
      />
      <span>{timeLabel(duration)}</span>
    </div>
    <div class="settings">
      <label>
        Speed
        <input
          aria-label="Sasayaki playback speed"
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={session.rate}
          oninput={(event) => onRateChange(Number(event.currentTarget.value))}
        />
        <span>{session.rate.toFixed(2)}x</span>
      </label>
      <label>
        Cue delay
        <input
          aria-label="Sasayaki cue delay"
          type="range"
          min="-2"
          max="2"
          step="0.05"
          value={session.delay}
          oninput={(event) => onDelayChange(Number(event.currentTarget.value))}
        />
        <span>{session.delay >= 0 ? "+" : ""}{session.delay.toFixed(2)}s</span>
      </label>
      <label class="switch-setting">
        <input
          aria-label="Sasayaki Auto-Scroll"
          type="checkbox"
          checked={session.autoScroll}
          onchange={(event) => onAutoScrollChange(event.currentTarget.checked)}
        />
        <span>Auto-Scroll</span>
      </label>
      <label class="switch-setting">
        <input
          aria-label="Sasayaki Auto-Pause on Lookup"
          type="checkbox"
          checked={session.autoPause}
          onchange={(event) => onAutoPauseChange(event.currentTarget.checked)}
        />
        <span>Auto-Pause on Lookup</span>
      </label>
      <label class="select-setting">
        Skip action
        <select
          aria-label="Sasayaki skip action"
          value={session.skipAction}
          onchange={(event) => onSkipActionChange(event.currentTarget.value as SasayakiSkipAction)}
        >
          <option value="cue">1 sentence</option>
          <option value="seconds5">5 seconds</option>
          <option value="seconds10">10 seconds</option>
          <option value="seconds15">15 seconds</option>
          <option value="seconds30">30 seconds</option>
        </select>
      </label>
    </div>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .player-panel { position: fixed; left: 50%; bottom: 38px; z-index: 120; width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 70px); overflow: auto; transform: translateX(-50%); display: flex; flex-direction: column; gap: 12px; padding: 14px; color: var(--app-text); background: color-mix(in srgb, var(--app-surface) 96%, transparent); border: 1px solid var(--app-border); border-radius: 10px 10px 0 0; box-shadow: 0 -8px 28px var(--app-shadow); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  header div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  header span, p { overflow-wrap: anywhere; color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  button { min-height: 34px; padding: 0 10px; color: var(--app-text); background: var(--app-control); border: 1px solid var(--app-border); border-radius: 6px; cursor: pointer; font-weight: 600; }
  button:hover { background: var(--app-control-hover); }
  button.primary { color: var(--app-bg); background: var(--app-primary); border-color: var(--app-primary); }
  .transport { display: flex; justify-content: center; flex-wrap: wrap; gap: 7px; }
  .timeline { display: grid; grid-template-columns: 42px minmax(0, 1fr) 42px; align-items: center; gap: 8px; font-size: 11px; color: var(--app-muted); }
  input[type="range"] { width: 100%; accent-color: var(--app-primary); }
  .settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .settings label { min-width: 0; display: grid; grid-template-columns: auto minmax(80px, 1fr) 48px; align-items: center; gap: 8px; color: var(--app-muted); font-size: 12px; }
  .settings span { text-align: right; color: var(--app-text); }
  .settings .switch-setting { grid-template-columns: auto 1fr; }
  .settings .switch-setting input { width: 16px; height: 16px; accent-color: var(--app-primary); }
  .settings .switch-setting span { text-align: left; }
  .settings .select-setting { grid-template-columns: auto minmax(120px, 1fr); }
  select { min-height: 34px; padding: 0 8px; color: var(--app-text); background: var(--app-control); border: 1px solid var(--app-border); border-radius: 6px; }
  .error { color: var(--app-error); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color); outline-offset: var(--ui-focus-ring-offset); }
  @media (max-width: 560px) {
    .player-panel { width: calc(100vw - 12px); padding: 12px; }
    .transport { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .transport .primary { grid-column: 1 / -1; grid-row: 1; }
    .settings { grid-template-columns: 1fr; }
  }
</style>
