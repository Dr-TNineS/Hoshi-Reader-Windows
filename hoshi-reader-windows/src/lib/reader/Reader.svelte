<script lang="ts">
  import { getTotalChars } from "../reader";

  let {
    content = "",
    chapterIndex = 0,
    totalChapters = 0,
    onPrevChapter = () => {},
    onPrevChapterDirect = () => {},
    onNextChapter = () => {},
    onBackToShelf = () => {},
    startAtEnd = false,
  } = $props();

  let containerEl: HTMLDivElement = $state()!;
  let contentEl: HTMLDivElement = $state()!;
  let charCount = $state(0);
  let currentPage = $state(0);
  let totalPages = $state(1);
  let initializing = $state(false);
  let lastSnappedScroll = $state(0);
  let pageWidth = $state(typeof window === "undefined" ? 0 : window.innerWidth);
  let pageHeight = $state(typeof window === "undefined" ? 0 : window.innerHeight);
  let layoutReady = $state(false);
  let activeContent = $state("");
  let layoutRun = 0;

  let styleVars = $derived(`--page-width:${pageWidth}px;--page-height:${pageHeight}px`);

  function pageSize(): number {
    return containerEl?.clientWidth || window.innerWidth;
  }

  function syncPageGeometry() {
    if (!containerEl) return;
    const nextWidth = containerEl.clientWidth || window.innerWidth;
    const nextHeight = containerEl.clientHeight || window.innerHeight;
    if (Math.abs(nextWidth - pageWidth) > 0.5) pageWidth = nextWidth;
    if (Math.abs(nextHeight - pageHeight) > 0.5) pageHeight = nextHeight;
  }

  function measureTotalPages(): number {
    if (!containerEl || !contentEl) return 1;
    const ps = pageSize();
    const sw = containerEl.scrollWidth || ps;
    return Math.max(1, Math.ceil(sw / ps));
  }

  function recalc() {
    totalPages = measureTotalPages();
  }

  function waitFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function waitTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForContentAssets(el: HTMLElement, run: number): Promise<void> {
    const fontReady = document.fonts?.ready?.then(() => undefined).catch(() => undefined) ?? Promise.resolve();
    const images = Array.from(el.querySelectorAll("img"));
    const imageReady = images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    });

    await Promise.race([
      Promise.all([fontReady, ...imageReady]).then(() => undefined),
      waitTimeout(1400),
    ]);

    if (run !== layoutRun) return;
    images.forEach((img) => {
      if (img.naturalWidth > 256 || img.naturalHeight > 256) {
        img.classList.add("block-img");
      }
    });
    await waitFrame();
  }

  async function waitForStableLayout(run: number): Promise<number> {
    let lastScrollWidth = -1;
    let lastPages = -1;
    let stableFrames = 0;

    for (let i = 0; i < 18; i += 1) {
      await waitFrame();
      if (run !== layoutRun || !containerEl) return totalPages;

      syncPageGeometry();
      const pages = measureTotalPages();
      const scrollWidth = Math.round(containerEl.scrollWidth);
      const same = scrollWidth === lastScrollWidth && pages === lastPages;

      stableFrames = same ? stableFrames + 1 : 0;
      lastScrollWidth = scrollWidth;
      lastPages = pages;
      totalPages = pages;

      if (stableFrames >= 2) return pages;
    }

    return lastPages > 0 ? lastPages : measureTotalPages();
  }

  function pageScrollFor(page: number): number {
    return (totalPages - 1 - page) * pageSize();
  }

  function goPage(page: number) {
    if (!containerEl) return;
    currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const scrollTarget = pageScrollFor(currentPage);
    lastSnappedScroll = scrollTarget;
    containerEl.scrollLeft = scrollTarget;
  }

  function next() {
    if (currentPage < totalPages - 1) goPage(currentPage + 1);
    else onNextChapter();
  }

  function prev() {
    if (currentPage > 0) goPage(currentPage - 1);
    else onPrevChapter();
  }

  function onScroll() {
    if (!containerEl || initializing) return;
    const ps = pageSize();
    if (ps <= 0) return;

    const currentScroll = containerEl.scrollLeft;
    const snappedScroll = Math.round(currentScroll / ps) * ps;

    if (Math.abs(currentScroll - snappedScroll) > 1) {
      containerEl.scrollLeft = lastSnappedScroll;
      return;
    }

    lastSnappedScroll = snappedScroll;
    const raw = Math.round(containerEl.scrollLeft / ps);
    currentPage = Math.max(0, Math.min(totalPages - 1, totalPages - 1 - raw));
  }

  function handleKey(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "ArrowLeft") {
      e.preventDefault();
      onNextChapter();
    } else if (ctrl && e.key === "ArrowRight") {
      e.preventDefault();
      onPrevChapterDirect();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      next();
    } else if (e.key === "Escape") {
      onBackToShelf();
    }
  }

  $effect.pre(() => {
    if (content !== activeContent) {
      activeContent = content;
      layoutReady = false;
      initializing = true;
      layoutRun += 1;
    }
  });

  $effect(() => {
    const el = contentEl;
    if (!content || !el) return;

    const run = layoutRun;

    queueMicrotask(async () => {
      syncPageGeometry();
      await waitForContentAssets(el, run);
      if (run !== layoutRun) return;

      charCount = getTotalChars(el);
      const pages = await waitForStableLayout(run);
      if (run !== layoutRun || !containerEl) return;

      initializing = true;
      if (startAtEnd) {
        currentPage = pages - 1;
        containerEl.scrollLeft = 0;
      } else {
        currentPage = 0;
        containerEl.scrollLeft = containerEl.scrollWidth;
      }

      await waitFrame();
      if (run !== layoutRun || !containerEl) return;
      initializing = false;
      lastSnappedScroll = containerEl.scrollLeft;
      layoutReady = true;
    });

    const ro = new ResizeObserver(() => {
      syncPageGeometry();
      recalc();
    });
    ro.observe(el);
    if (containerEl) ro.observe(containerEl);

    return () => ro.disconnect();
  });
</script>

<svelte:window onkeydown={handleKey} />

<div class="rc">
  <div class="rh">
    <span>Ch.{chapterIndex + 1}/{totalChapters} | P.{currentPage + 1}/{totalPages} | {charCount}c</span>
  </div>

  <div bind:this={containerEl} class="rv" class:ready={layoutReady} onscroll={onScroll}>
    <div bind:this={contentEl} class="rct" style={styleVars}>
      {@html content}
    </div>
  </div>
</div>

<style>
  .rc {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #1a1a1a;
    color: #ccc;
  }

  .rh {
    display: flex;
    align-items: center;
    padding: 3px 10px;
    font-size: 10px;
    color: #888;
    background: #111;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
    user-select: none;
  }

  .rv {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .rv:not(.ready) {
    opacity: 0;
  }

  .rv.ready {
    opacity: 1;
  }

  .rct {
    --font-size: 21px;
    --line-height: 1.9;
    --safe-block: 2vh;
    --safe-inline: clamp(48px, 8vw, 112px);
    --content-width: max(1px, calc(var(--page-width, 100vw) - (var(--safe-inline) * 2)));
    --column-gap: calc(var(--safe-inline) * 2);
    --content-height: max(1px, calc(var(--page-height, 100vh) - (var(--safe-block) * 2)));

    height: 100%;
    width: max-content;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    column-width: var(--content-width);
    column-gap: var(--column-gap);
    column-fill: auto;
    orphans: 1;
    widows: 1;
    padding: var(--safe-block) var(--safe-inline);
    padding-bottom: calc(var(--font-size) * 0.55 + var(--safe-block));
    overflow-x: visible;
    overflow-wrap: anywhere;
    word-break: normal;
    font-family: "Yu Mincho", "Hiragino Mincho Pro", "MS Mincho", serif;
    font-size: var(--font-size);
    line-height: var(--line-height);
    text-indent: 0;
  }

  .rct :global(*) {
    max-width: 100% !important;
    box-sizing: border-box !important;
  }

  .rct :global(img) {
    max-width: 100%;
    max-height: var(--content-height, 80vh);
    object-fit: contain;
  }

  .rct :global(img.block-img) {
    display: block;
    margin: 0 auto;
    width: auto;
    height: auto;
    break-inside: avoid;
  }

  .rct :global(h1),
  .rct :global(h2),
  .rct :global(h3),
  .rct :global(h4),
  .rct :global(h5),
  .rct :global(h6),
  .rct :global(figure),
  .rct :global(table),
  .rct :global(blockquote),
  .rct :global(svg) {
    break-inside: avoid !important;
    -webkit-column-break-inside: avoid !important;
  }

  .rct :global(ruby) {
    ruby-align: center;
  }

  .rct :global(rt) {
    font-size: 0.5em;
  }
</style>
