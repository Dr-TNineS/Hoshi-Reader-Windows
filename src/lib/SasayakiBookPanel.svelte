<script lang="ts">
  import type { SasayakiStatus } from "./types";
  import type { BookRecord } from "./storage";
  import ConfirmDialog from "./ui/ConfirmDialog.svelte";

  let {
    book,
    status = null,
    message = "",
    error = "",
    busy = false,
    onClose,
    onImport,
    onRemove,
  }: {
    book: BookRecord;
    status?: SasayakiStatus | null;
    message?: string;
    error?: string;
    busy?: boolean;
    onClose: () => void;
    onImport: (copyAudio: boolean) => void;
    onRemove: () => void;
  } = $props();

  function sizeLabel(bytes: number | null): string {
    if (bytes === null) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
      <div><dt>Matching</dt><dd>Not started · {status.cueCount} cues stored</dd></div>
    </dl>
  {/if}

  <div class="messages" aria-live="polite">
    {#if message}<p class="message">{message}</p>{/if}
    {#if error}<p class="message error">{error}</p>{/if}
  </div>

  <div class="actions">
    <button disabled={busy} onclick={() => onImport(false)}>
      {busy ? "Working..." : "Link audio + SRT"}
    </button>
    <button disabled={busy} onclick={() => onImport(true)}>
      {busy ? "Working..." : "Copy audio + SRT"}
    </button>
    {#if status?.configured}
      <ConfirmDialog
        title={`Remove Sasayaki from ${book.title}?`}
        description="This removes app-owned Sasayaki subtitles and any copied audio. A linked external audiobook is not deleted."
        confirmLabel="Remove"
        disabled={busy}
        onConfirm={onRemove}
      >
        {#snippet trigger()}Remove{/snippet}
      </ConfirmDialog>
    {/if}
  </div>

  <p class="scope-note">
    MP3 and WAV are supported in this slice. Cue matching and playback are not implemented yet.
  </p>
</section>

<style>
  .sasayaki-panel { min-width: 0; display: flex; flex-direction: column; gap: 14px; padding: 18px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 10px; }
  header { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .eyebrow { margin-bottom: 3px; color: var(--app-primary); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  h3 { overflow-wrap: anywhere; }
  .close-button { min-height: 32px; padding: 0 10px; flex-shrink: 0; background: transparent; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 7px; cursor: pointer; }
  .close-button:hover { background: var(--app-control-hover); }
  .summary, .scope-note { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
  .status-grid { display: grid; gap: 8px; }
  .status-grid div { min-width: 0; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 12px; }
  dt { color: var(--app-muted); font-size: 12px; font-weight: 650; }
  dd { min-width: 0; overflow-wrap: anywhere; color: var(--app-text); font-size: 13px; }
  .messages { display: flex; flex-direction: column; gap: 6px; }
  .message { padding: 8px 10px; color: var(--app-status); background: color-mix(in srgb, var(--app-status) 9%, var(--app-bg)); border: 1px solid color-mix(in srgb, var(--app-status) 35%, var(--app-border)); border-radius: 7px; font-size: 12px; line-height: 1.4; }
  .message.error { color: var(--app-error); background: color-mix(in srgb, var(--app-error) 9%, var(--app-bg)); border-color: color-mix(in srgb, var(--app-error) 35%, var(--app-border)); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .actions > button { min-height: 36px; padding: 0 12px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .actions > button:hover:not(:disabled) { background: var(--app-control-hover); }
  .actions > button:disabled { cursor: default; opacity: 0.65; }
  .close-button:focus-visible, .actions > button:focus-visible { outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color); outline-offset: var(--ui-focus-ring-offset); }
  @media (max-width: 560px) {
    header { align-items: stretch; flex-direction: column; }
    .close-button { align-self: flex-start; }
    .status-grid div { grid-template-columns: 1fr; gap: 3px; }
    .actions { flex-direction: column; }
    .actions > button { width: 100%; }
  }
</style>
