<script lang="ts">
  import { Tooltip } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    children,
    label,
    tooltip,
    disabled = false,
    onClick,
  }: {
    children: Snippet;
    label: string;
    tooltip: string;
    disabled?: boolean;
    onClick: () => void;
  } = $props();
</script>

<Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
  <Tooltip.Root disabled={disabled}>
    <Tooltip.Trigger class="ui-icon-button" aria-label={label} {disabled} onclick={onClick}>
      {@render children()}
    </Tooltip.Trigger>
    <Tooltip.Portal to="[data-ui-portal-root]">
      <Tooltip.Content class="ui-tooltip-content" role="tooltip" sideOffset={6}>
        {tooltip}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  :global(.ui-icon-button) {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--app-control, #1b1b1b);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  :global(.ui-icon-button:hover:not(:disabled)) { background: var(--app-control-hover, #262626); }
  :global(.ui-icon-button:disabled) { color: var(--app-muted, #999999); cursor: default; }
  :global(.ui-icon-button:focus-visible) {
    outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color);
    outline-offset: var(--ui-focus-ring-offset);
  }
  :global(.ui-tooltip-content) {
    z-index: 260;
    max-width: min(240px, calc(100vw - 24px));
    padding: 5px var(--ui-space-2);
    background: var(--app-surface, #121212);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-sm);
    box-shadow: var(--ui-dialog-shadow);
    font-size: 11px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
</style>
