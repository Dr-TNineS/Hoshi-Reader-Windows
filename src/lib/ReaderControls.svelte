<script lang="ts">
  let {
    chapterIndex = 0,
    totalChapters = 0,
    onPrevChapter,
    onNextChapter,
    onToggleToc,
    onBackToShelf,
    tocOpen = false,
  }: {
    chapterIndex?: number;
    totalChapters?: number;
    onPrevChapter: () => void;
    onNextChapter: () => void;
    onToggleToc: () => void;
    onBackToShelf: () => void;
    tocOpen?: boolean;
  } = $props();
</script>

<div class="ctrls">
  <button onclick={onPrevChapter}>Prev Ch</button>
  <span>Ch.{chapterIndex + 1}/{totalChapters}</span>
  <button onclick={onNextChapter}>Next Ch</button>
  <button
    id="reader-toc-trigger"
    aria-expanded={tocOpen}
    aria-controls="reader-toc"
    onclick={onToggleToc}
  >TOC</button>
  <button onclick={onBackToShelf}>Esc</button>
</div>

<style>
  .ctrls { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; background: var(--app-bg); border-top: 1px solid var(--app-border); z-index: 100; }
  .ctrls button { padding: 4px 10px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px; cursor: pointer; font-size: 12px; }
  .ctrls button:hover { background: var(--app-control-hover); }
  .ctrls span { font-size: 12px; color: var(--app-muted); }
</style>
