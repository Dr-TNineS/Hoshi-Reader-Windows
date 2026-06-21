<script lang="ts">
  import { AlertDialog } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    trigger,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    triggerAriaLabel,
    triggerVariant = "default",
    disabled = false,
    onConfirm,
  }: {
    trigger: Snippet;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    triggerAriaLabel?: string;
    triggerVariant?: "default" | "book-overlay";
    disabled?: boolean;
    onConfirm: () => void;
  } = $props();

  let open = $state(false);

  function handleConfirm() {
    onConfirm();
    open = false;
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Trigger class="dialog-trigger" data-variant={triggerVariant} aria-label={triggerAriaLabel} {disabled}>
    {@render trigger()}
  </AlertDialog.Trigger>
  <AlertDialog.Portal disabled>
    <AlertDialog.Overlay class="dialog-overlay" />
    <AlertDialog.Content class="dialog-content">
      <AlertDialog.Title class="dialog-title">{title}</AlertDialog.Title>
      <AlertDialog.Description class="dialog-description">{description}</AlertDialog.Description>
      <div class="dialog-actions">
        <AlertDialog.Cancel class="dialog-button dialog-cancel">{cancelLabel}</AlertDialog.Cancel>
        <AlertDialog.Action class="dialog-button dialog-confirm" onclick={handleConfirm}>
          {confirmLabel}
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

<style>
  :global(.dialog-trigger) {
    min-width: 58px;
    min-height: var(--ui-control-height-sm);
    padding: 5px 8px;
    background: transparent;
    color: var(--app-error, #ffb4ab);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 12px;
  }

  :global(.dialog-trigger:hover:not(:disabled)) { background: var(--app-control-hover, #262626); }
  :global(.dialog-trigger:disabled) { color: var(--app-muted, #999999); cursor: default; }
  :global(.dialog-trigger[data-variant="book-overlay"]) {
    position: absolute;
    top: 8px;
    right: 8px;
    min-height: 28px;
    background: color-mix(in srgb, var(--app-bg, #000000) 82%, transparent);
    color: var(--app-text, #ffffff);
    border-color: color-mix(in srgb, var(--app-border, #333333) 80%, transparent);
    border-radius: var(--ui-radius-md);
    opacity: 0;
    transition: opacity var(--ui-transition-fast), background var(--ui-transition-fast);
  }
  :global(.book-card:hover .dialog-trigger[data-variant="book-overlay"]),
  :global(.dialog-trigger[data-variant="book-overlay"]:focus-visible) { opacity: 1; }
  :global(.dialog-trigger:focus-visible),
  :global(.dialog-button:focus-visible) {
    outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color);
    outline-offset: var(--ui-focus-ring-offset);
  }

  :global(.dialog-overlay) {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: var(--ui-overlay);
  }

  :global(.dialog-content) {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 301;
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
    padding: var(--ui-space-5);
    overflow-y: auto;
    transform: translate(-50%, -50%);
    background: var(--app-surface, #121212);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-dialog-shadow);
    outline: none;
  }

  :global(.dialog-title) { font-size: 17px; font-weight: 650; line-height: 1.35; }
  :global(.dialog-description) { color: var(--app-muted, #999999); font-size: 13px; line-height: 1.5; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: var(--ui-space-2); margin-top: var(--ui-space-1); }
  :global(.dialog-button) {
    min-height: var(--ui-control-height-md);
    padding: 0 var(--ui-space-4);
    border-radius: var(--ui-radius-md);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }
  :global(.dialog-cancel) {
    background: var(--app-control, #1b1b1b);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
  }
  :global(.dialog-cancel:hover) { background: var(--app-control-hover, #262626); }
  :global(.dialog-confirm) {
    background: var(--app-error, #ffb4ab);
    color: var(--app-bg, #000000);
    border: 1px solid transparent;
  }
  :global(.dialog-confirm:hover) { filter: brightness(0.94); }

  @media (max-width: 420px) {
    .dialog-actions { flex-direction: column-reverse; }
    :global(.dialog-button) { width: 100%; }
  }

  @media (max-width: 640px) {
    :global(.dialog-trigger[data-variant="book-overlay"]) { opacity: 1; }
  }
</style>
