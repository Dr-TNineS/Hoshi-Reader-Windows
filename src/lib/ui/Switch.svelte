<script lang="ts">
  import { Switch } from "bits-ui";

  let {
    id,
    checked,
    disabled = false,
    ariaLabel,
    ariaLabelledby,
    onCheckedChange,
  }: {
    id?: string;
    checked: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    ariaLabelledby?: string;
    onCheckedChange: (checked: boolean) => void;
  } = $props();
</script>

<Switch.Root
  {id}
  {checked}
  {disabled}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  {onCheckedChange}
  class="ui-switch"
>
  <Switch.Thumb class="ui-switch-thumb" />
</Switch.Root>

<style>
  :global(.ui-switch) {
    width: 42px;
    height: 22px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    padding: 2px;
    background: var(--app-border, #333333);
    border: 1px solid transparent;
    border-radius: 999px;
    cursor: pointer;
    transition: background var(--ui-transition-fast), opacity var(--ui-transition-fast);
  }

  :global(.ui-switch[data-state="checked"]) { background: var(--app-primary, #d0bcff); }
  :global(.ui-switch:hover:not(:disabled)) { background: var(--app-muted, #999999); }
  :global(.ui-switch[data-state="checked"]:hover:not(:disabled)) { background: var(--app-primary-hover, #c1a9fb); }
  :global(.ui-switch:disabled) { cursor: default; opacity: 0.5; }
  :global(.ui-switch:focus-visible) {
    outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color);
    outline-offset: var(--ui-focus-ring-offset);
  }

  :global(.ui-switch-thumb) {
    width: 16px;
    height: 16px;
    display: block;
    background: var(--app-bg, #000000);
    border-radius: 50%;
    pointer-events: none;
    transform: translateX(0);
    transition: transform var(--ui-transition-fast);
  }

  :global(.ui-switch-thumb[data-state="checked"]) { transform: translateX(20px); }
</style>
