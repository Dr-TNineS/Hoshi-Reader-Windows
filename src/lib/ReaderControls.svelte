<script lang="ts">
  let {
    onPrevChapter,
    onNextChapter,
    onToggleToc,
    onBackToShelf,
    onToggleSasayaki = () => {},
    tocOpen = false,
    sasayakiOpen = false,
    sasayakiAvailable = false,
  }: {
    onPrevChapter: () => void;
    onNextChapter: () => void;
    onToggleToc: () => void;
    onBackToShelf: () => void;
    onToggleSasayaki?: () => void;
    tocOpen?: boolean;
    sasayakiOpen?: boolean;
    sasayakiAvailable?: boolean;
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
  <button onclick={onBackToShelf}>Esc</button>
</div>

<style>
  .ctrls { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; background: var(--app-bg); border-top: 1px solid var(--app-border); z-index: 100; }
  .ctrls button { padding: 4px 10px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px; cursor: pointer; font-size: 12px; }
  .ctrls button:hover { background: var(--app-control-hover); }
  .ctrls button.available { border-color: var(--app-primary); }
</style>
