<script lang="ts">
  import {
    shortcutTokens,
    type ShortcutBinding,
  } from "./global-lookup-settings";
  import { shortcutFromKeyboardEvent } from "./keyboard-shortcuts";

  let {
    shortcut,
    defaultShortcut = shortcut,
    requireCommandModifier = true,
    externalError = "",
    ariaLabel = "Global selected-text lookup shortcut",
    align = "end",
    onShortcutChange,
    onShortcutReset,
  }: {
    shortcut: ShortcutBinding;
    defaultShortcut?: ShortcutBinding;
    requireCommandModifier?: boolean;
    externalError?: string;
    ariaLabel?: string;
    align?: "start" | "end";
    onShortcutChange: (shortcut: ShortcutBinding) => void;
    onShortcutReset: () => void;
  } = $props();

  let recordingShortcut = $state(false);
  let recordingError = $state("");

  const shortcutTokensList = $derived(shortcutTokens(shortcut));

  function beginRecording() {
    recordingError = "";
    recordingShortcut = true;
  }

  function finishRecording() {
    recordingShortcut = false;
  }

  function resetShortcut() {
    recordingError = "";
    finishRecording();
    onShortcutReset();
  }

  function handleRecordingKeydown(event: KeyboardEvent) {
    if (!recordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    const result = shortcutFromKeyboardEvent(event, { requireCommandModifier });
    if (result.status === "cancel") {
      finishRecording();
      return;
    }
    if (result.status === "reset") {
      resetShortcut();
      return;
    }
    if (result.status === "invalid") {
      recordingError = result.message;
      return;
    }
    recordingError = "";
    finishRecording();
    onShortcutChange(result.shortcut);
  }
</script>

<svelte:window onkeydown={handleRecordingKeydown} />

<div class="shortcut-editor" class:align-start={align === "start"} aria-label={ariaLabel}>
  <div class="shortcut-binding" aria-live="polite">
    {#each shortcutTokensList as token, tokenIndex}
      {#if tokenIndex > 0}<span class="binding-plus">+</span>{/if}
      <kbd>{token}</kbd>
    {/each}
  </div>
  <div class="shortcut-actions">
    <button
      type="button"
      aria-pressed={recordingShortcut}
      class:recording={recordingShortcut}
      onclick={beginRecording}
      onkeydown={handleRecordingKeydown}
    >
      {recordingShortcut ? "Recording" : "Record"}
    </button>
    <button type="button" onclick={resetShortcut}>Reset</button>
  </div>
  {#if recordingError || externalError}
    <p class="shortcut-message shortcut-error">{recordingError || externalError}</p>
  {:else if recordingShortcut}
    <p class="shortcut-message">Press a shortcut. Esc cancels, Backspace resets to {defaultShortcut.displayLabel}.</p>
  {/if}
</div>

<style>
  .shortcut-editor {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  .shortcut-editor.align-start { align-items: flex-start; }
  .shortcut-binding {
    min-height: 30px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
  }
  .align-start .shortcut-binding { justify-content: flex-start; }
  .binding-plus { color: var(--app-muted); font-size: 11px; }
  kbd {
    min-width: 28px;
    min-height: 27px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    background: var(--app-control);
    color: var(--app-text);
    border: 1px solid var(--app-border);
    border-bottom-color: var(--app-muted);
    border-radius: 5px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--app-muted) 35%, transparent);
  }
  .shortcut-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .align-start .shortcut-actions { justify-content: flex-start; }
  .shortcut-actions button {
    min-height: 32px;
    padding: 0 10px;
    background: var(--app-control);
    color: var(--app-text);
    border: 1px solid var(--app-border);
    border-radius: 7px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .shortcut-actions button:hover { background: var(--app-control-hover); }
  .shortcut-actions button.recording {
    border-color: var(--app-primary);
    color: var(--app-primary);
  }
  .shortcut-message {
    max-width: 260px;
    margin: 0;
    color: var(--app-status);
    font-size: 12px;
    line-height: 1.4;
    text-align: right;
  }
  .align-start .shortcut-message { text-align: left; }
  .shortcut-error { color: var(--app-error); }

  @media (max-width: 640px) {
    .shortcut-editor { align-items: flex-start; }
    .shortcut-binding,
    .shortcut-actions { justify-content: flex-start; }
    .shortcut-message { text-align: left; }
  }
</style>
