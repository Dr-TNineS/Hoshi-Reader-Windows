<script lang="ts">
  import type { SasayakiCueItem, SasayakiStatus } from "./types";
  import type { BookRecord } from "./storage";
  import ConfirmDialog from "./ui/ConfirmDialog.svelte";

  let {
    book,
    status = null,
    cues = [],
    message = "",
    error = "",
    busy = false,
    onClose,
    onImport,
    onRemove,
    onRematch,
    onCorrect,
    onClearCorrection,
  }: {
    book: BookRecord;
    status?: SasayakiStatus | null;
    cues?: SasayakiCueItem[];
    message?: string;
    error?: string;
    busy?: boolean;
    onClose: () => void;
    onImport: (copyAudio: boolean) => void;
    onRemove: () => void;
    onRematch: (searchWindow: number) => void;
    onCorrect: (cueId: string, chapterIndex: number, start: number, length: number) => void;
    onClearCorrection: (cueId: string) => void;
  } = $props();

  let searchWindow = $state(200);
  let selectedCueId = $state<string | null>(null);
  let correctionChapter = $state(0);
  let correctionStart = $state(0);
  let correctionLength = $state(1);
  let selectedCue = $derived(cues.find((cue) => cue.id === selectedCueId) ?? null);

  function sizeLabel(bytes: number | null): string {
    if (bytes === null) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function timeLabel(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds - minutes * 60;
    return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
  }

  function storageDescription(): string {
    if (status?.configured && !status.audioAvailable) {
      return "The linked external audiobook is unavailable. Select the audio and SRT pair again to relink it.";
    }
    if (status?.audioStorage === "copied") {
      return "Copied to app storage. The original audiobook can be moved or deleted.";
    }
    if (status?.audioStorage === "external") {
      return "Linked to the external audiobook. Keep the original file available.";
    }
    return "No audiobook and subtitle pair is configured.";
  }

  function selectCue(cue: SasayakiCueItem) {
    selectedCueId = cue.id;
    correctionChapter = cue.chapterIndex ?? 0;
    correctionStart = cue.start ?? 0;
    correctionLength = cue.length ?? Math.max(1, [...cue.text].length);
  }

  function saveCorrection() {
    if (!selectedCue) return;
    onCorrect(
      selectedCue.id,
      Math.max(0, Math.trunc(correctionChapter)),
      Math.max(0, Math.trunc(correctionStart)),
      Math.max(1, Math.trunc(correctionLength)),
    );
  }
</script>

<section class="sasayaki-panel" aria-label={`Sasayaki for ${book.title}`}>
  <header>
    <div>
      <p class="eyebrow">Per-book audiobook</p>
      <h3>Sasayaki for {book.title}</h3>
    </div>
    <button class="close-button" aria-label="Close Sasayaki setup" onclick={onClose}>Close</button>
  </header>

  <p class="summary">{storageDescription()}</p>
  {#if status?.configured}
    <dl class="status-grid">
      <div><dt>Audio</dt><dd>{status.audioFileName} · {status.audioExtension?.toUpperCase()} · {sizeLabel(status.audioSizeBytes)}</dd></div>
      <div><dt>Subtitles</dt><dd>{status.subtitleFileName} · {sizeLabel(status.subtitleSizeBytes)}</dd></div>
      <div>
        <dt>Matching</dt>
        <dd>{status.matchedCount}/{status.cueCount} matched · {status.matchRate.toFixed(1)}% · {status.correctedCount} corrected</dd>
      </div>
    </dl>

    <div class="match-controls">
      <label for="sasayaki-search-window">
        Search window
        <span>How many filtered book characters to scan ahead for each cue.</span>
      </label>
      <div>
        <input id="sasayaki-search-window" type="number" min="50" max="1000" step="25" bind:value={searchWindow} disabled={busy} />
        <button disabled={busy} onclick={() => onRematch(searchWindow)}>Match again</button>
      </div>
    </div>

    <section class="cue-inspector" aria-label="Sasayaki cue inspection">
      <div class="cue-heading">
        <div>
          <h4>Cue inspection</h4>
          <p>Showing the first {cues.length} of {status.cueCount} cues.</p>
        </div>
        <span>{status.unmatchedCount} unmatched</span>
      </div>

      {#if cues.length === 0}
        <p class="empty-cues">Run matching to inspect cue results.</p>
      {:else}
        <div class="cue-workspace">
          <div class="cue-list" role="list" aria-label="Subtitle cues">
            {#each cues as cue (cue.id)}
              <button
                class:selected={cue.id === selectedCueId}
                class:unmatched={!cue.matched}
                aria-pressed={cue.id === selectedCueId}
                onclick={() => selectCue(cue)}
              >
                <span class="cue-meta">
                  <strong>#{cue.id}</strong>
                  <span>{timeLabel(cue.startTime)}–{timeLabel(cue.endTime)}</span>
                  <span class="cue-state">{cue.corrected ? "Corrected" : cue.matched ? "Matched" : "Unmatched"}</span>
                </span>
                <span class="cue-text">{cue.text}</span>
                {#if cue.matched}
                  <span class="cue-location">Chapter {cue.chapterIndex}, start {cue.start}, length {cue.length}</span>
                {/if}
              </button>
            {/each}
          </div>

          <form
            class="correction-form"
            onsubmit={(event) => {
              event.preventDefault();
              saveCorrection();
            }}
          >
            <h4>Manual correction</h4>
            {#if selectedCue}
              <p>Override cue #{selectedCue.id} with a filtered-text range. Coordinates are zero-based.</p>
              <div class="correction-fields">
                <label>Chapter index<input type="number" min="0" step="1" bind:value={correctionChapter} disabled={busy} /></label>
                <label>Start<input type="number" min="0" step="1" bind:value={correctionStart} disabled={busy} /></label>
                <label>Length<input type="number" min="1" step="1" bind:value={correctionLength} disabled={busy} /></label>
              </div>
              <div class="correction-actions">
                <button type="submit" disabled={busy}>Save correction</button>
                {#if selectedCue.corrected}
                  <button type="button" disabled={busy} onclick={() => onClearCorrection(selectedCue!.id)}>Use automatic match</button>
                {/if}
              </div>
            {:else}
              <p>Select a cue to inspect or correct its EPUB location.</p>
            {/if}
          </form>
        </div>
      {/if}
    </section>
  {/if}

  <div class="messages" aria-live="polite">
    {#if message}<p class="message">{message}</p>{/if}
    {#if error}<p class="message error">{error}</p>{/if}
  </div>

  <div class="actions">
    <button disabled={busy} onclick={() => onImport(false)}>{busy ? "Working..." : "Link audio + SRT"}</button>
    <button disabled={busy} onclick={() => onImport(true)}>{busy ? "Working..." : "Copy audio + SRT"}</button>
    {#if status?.configured}
      <ConfirmDialog
        title={`Remove Sasayaki from ${book.title}?`}
        description="This removes app-owned Sasayaki subtitles, matches, corrections, and any copied audio. A linked external audiobook is not deleted."
        confirmLabel="Remove"
        disabled={busy}
        onConfirm={onRemove}
      >
        {#snippet trigger()}Remove{/snippet}
      </ConfirmDialog>
    {/if}
  </div>

  <p class="scope-note">M4B, MP3, and WAV cue matching is available. Playback and reader highlighting remain separate reader features.</p>
</section>

<style>
  .sasayaki-panel { min-width: 0; display: flex; flex-direction: column; gap: 14px; padding: 18px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 10px; }
  header { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .eyebrow { margin-bottom: 3px; color: var(--app-primary); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  h3, h4 { overflow-wrap: anywhere; }
  .close-button { min-height: 32px; padding: 0 10px; flex-shrink: 0; background: transparent; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 7px; cursor: pointer; }
  .close-button:hover { background: var(--app-control-hover); }
  .summary, .scope-note { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
  .status-grid { display: grid; gap: 8px; }
  .status-grid div { min-width: 0; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 12px; }
  dt { color: var(--app-muted); font-size: 12px; font-weight: 650; }
  dd { min-width: 0; overflow-wrap: anywhere; color: var(--app-text); font-size: 13px; }
  .match-controls { display: grid; grid-template-columns: minmax(180px, 1fr) auto; align-items: end; gap: 16px; padding: 12px; background: var(--app-bg); border: 1px solid var(--app-border); border-radius: 8px; }
  .match-controls > label { color: var(--app-text); font-size: 13px; font-weight: 650; }
  .match-controls label span { display: block; margin-top: 3px; color: var(--app-muted); font-size: 11px; font-weight: 400; }
  .match-controls > div { display: flex; gap: 8px; }
  input { min-height: 34px; padding: 0 8px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 6px; }
  .match-controls input { width: 92px; }
  button { font: inherit; }
  .match-controls button, .correction-actions button, .actions > button { min-height: 36px; padding: 0 12px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .match-controls button:hover:not(:disabled), .correction-actions button:hover:not(:disabled), .actions > button:hover:not(:disabled) { background: var(--app-control-hover); }
  button:disabled, input:disabled { cursor: default; opacity: 0.65; }
  .cue-inspector { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .cue-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; }
  .cue-heading p, .correction-form p, .empty-cues { margin-top: 3px; color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  .cue-heading > span { color: var(--app-muted); font-size: 12px; white-space: nowrap; }
  .cue-workspace { min-width: 0; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(230px, 0.65fr); gap: 12px; }
  .cue-list { max-height: 340px; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 3px; }
  .cue-list > button { min-width: 0; display: flex; flex-direction: column; gap: 5px; padding: 9px 10px; text-align: left; background: var(--app-bg); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 7px; cursor: pointer; }
  .cue-list > button:hover, .cue-list > button.selected { border-color: var(--app-primary); background: color-mix(in srgb, var(--app-primary) 8%, var(--app-bg)); }
  .cue-list > button.unmatched { border-left: 3px solid var(--app-error); }
  .cue-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--app-muted); font-size: 11px; }
  .cue-meta strong { color: var(--app-text); }
  .cue-state { margin-left: auto; color: var(--app-primary); font-weight: 650; }
  .unmatched .cue-state { color: var(--app-error); }
  .cue-text { overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; }
  .cue-location { color: var(--app-muted); font-size: 11px; }
  .correction-form { align-self: start; display: flex; flex-direction: column; gap: 12px; padding: 12px; background: var(--app-bg); border: 1px solid var(--app-border); border-radius: 8px; }
  .correction-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .correction-fields label { min-width: 0; display: flex; flex-direction: column; gap: 4px; color: var(--app-muted); font-size: 11px; }
  .correction-fields input { width: 100%; min-width: 0; }
  .correction-actions, .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .messages { display: flex; flex-direction: column; gap: 6px; }
  .message { padding: 8px 10px; color: var(--app-status); background: color-mix(in srgb, var(--app-status) 9%, var(--app-bg)); border: 1px solid color-mix(in srgb, var(--app-status) 35%, var(--app-border)); border-radius: 7px; font-size: 12px; line-height: 1.4; }
  .message.error { color: var(--app-error); background: color-mix(in srgb, var(--app-error) 9%, var(--app-bg)); border-color: color-mix(in srgb, var(--app-error) 35%, var(--app-border)); }
  .close-button:focus-visible, button:focus-visible, input:focus-visible { outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color); outline-offset: var(--ui-focus-ring-offset); }
  @media (max-width: 760px) {
    .cue-workspace { grid-template-columns: 1fr; }
    .correction-form { align-self: stretch; }
  }
  @media (max-width: 560px) {
    header { align-items: stretch; flex-direction: column; }
    .close-button { align-self: flex-start; }
    .status-grid div, .match-controls { grid-template-columns: 1fr; gap: 5px; }
    .match-controls > div { align-items: stretch; }
    .match-controls input { flex: 1; width: auto; min-width: 0; }
    .correction-fields { grid-template-columns: 1fr; }
    .actions, .correction-actions { flex-direction: column; }
    .actions > button, .correction-actions button { width: 100%; }
    .cue-heading { align-items: flex-start; flex-direction: column; }
  }
</style>
