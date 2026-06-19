<script lang="ts">
  import { DropdownMenu } from "bits-ui";

  let {
    items,
    triggerAriaLabel,
    disabled = false,
    onSelect,
  }: {
    items: string[];
    triggerAriaLabel: string;
    disabled?: boolean;
    onSelect: (item: string) => void;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="handlebar-trigger" aria-label={triggerAriaLabel} {disabled}>
    {"{}"}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal to="[data-ui-portal-root]">
    <DropdownMenu.Content class="handlebar-menu" sideOffset={4} align="end">
      {#each items as item (item)}
        <DropdownMenu.Item class="handlebar-menu-item" onclick={() => onSelect(item)}>
          {item}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  :global(.handlebar-trigger) {
    width: 34px;
    min-height: var(--ui-control-height-sm);
    background: var(--app-control, #1b1b1b);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 12px;
  }
  :global(.handlebar-trigger:hover:not(:disabled)) { background: var(--app-control-hover, #262626); }
  :global(.handlebar-trigger:disabled) { color: var(--app-muted, #999999); cursor: default; }
  :global(.handlebar-trigger:focus-visible) {
    outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color);
    outline-offset: var(--ui-focus-ring-offset);
  }
  :global(.handlebar-menu) {
    z-index: 250;
    width: min(420px, calc(100vw - 24px));
    max-height: min(280px, calc(100vh - 24px));
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ui-space-1);
    overflow-y: auto;
    padding: var(--ui-space-2);
    background: var(--app-surface, #121212);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-md);
    box-shadow: var(--ui-dialog-shadow);
    outline: none;
  }
  :global(.handlebar-menu-item) {
    min-width: 0;
    padding: 6px var(--ui-space-2);
    overflow-wrap: anywhere;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 12px;
    outline: none;
  }
  :global(.handlebar-menu-item[data-highlighted]) { background: var(--app-control-hover, #262626); }

  @media (max-width: 520px) {
    :global(.handlebar-menu) { grid-template-columns: 1fr; }
  }
</style>
