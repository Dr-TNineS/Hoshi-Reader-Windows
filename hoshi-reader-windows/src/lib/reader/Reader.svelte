<script lang="ts">
  import { getTotalChars } from "../reader";

  let {
    content = "",
    chapterIndex = 0,
    totalChapters = 0,
    onPrevChapter = () => {},
    onPrevChapterDirect = () => {},
    onNextChapter = () => {},
    onNavigateHref = (_href: string) => {},
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
  let contentMaxScroll = 0;

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
    contentMaxScroll = measureContentMaxScroll();
    return Math.max(1, Math.floor(contentMaxScroll / ps) + 1);
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

  function markBlockImage(img: HTMLImageElement) {
    if (img.classList.contains("gaiji") || img.classList.contains("gaiji-line")) {
      return;
    }

    if (img.naturalWidth > 256 || img.naturalHeight > 256) {
      img.classList.add("block-img");
    }
  }

  function measureContentMaxScroll(): number {
    if (!containerEl || !contentEl) return 0;

    const ps = pageSize();
    const scrollLimit = Math.max(0, (containerEl.scrollWidth || ps) - ps);
    const currentScroll = containerEl.scrollLeft;
    let lastContentEdge = 0;

    const updateEdge = (rect: DOMRect | ClientRect) => {
      if (rect.width <= 0 || rect.height <= 0) return;
      lastContentEdge = Math.max(lastContentEdge, rect.right + currentScroll);
    };

    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest("rt, rp")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      Array.from(range.getClientRects()).forEach(updateEdge);
      range.detach();
    }

    contentEl.querySelectorAll("img, svg, image, video, canvas").forEach((media) => {
      updateEdge(media.getBoundingClientRect());
    });

    if (lastContentEdge <= 0) return scrollLimit;

    const lastContentScroll = Math.floor(Math.max(0, lastContentEdge - 1) / ps) * ps;
    return Math.min(scrollLimit, lastContentScroll);
  }

  async function waitForInitialFonts(): Promise<void> {
    const fontReady = document.fonts?.ready?.then(() => undefined).catch(() => undefined) ?? Promise.resolve();
    await Promise.race([fontReady, waitTimeout(120)]);
  }

  function watchImages(el: HTMLElement, run: number) {
    const images = Array.from(el.querySelectorAll("img"));
    images.forEach((img) => {
      if (img.complete) {
        markBlockImage(img);
        return;
      }

      img.addEventListener("load", () => {
        if (run !== layoutRun) return;
        markBlockImage(img);
        requestAnimationFrame(() => {
          if (run !== layoutRun) return;
          recalc();
          goPage(currentPage);
        });
      }, { once: true });
    });
  }

  async function waitForStableLayout(run: number): Promise<number> {
    let lastScrollWidth = -1;
    let lastMaxScroll = -1;
    let lastPages = -1;
    let stableFrames = 0;

    for (let i = 0; i < 8; i += 1) {
      await waitFrame();
      if (run !== layoutRun || !containerEl) return totalPages;

      syncPageGeometry();
      const pages = measureTotalPages();
      const scrollWidth = Math.round(containerEl.scrollWidth);
      const maxScroll = Math.round(contentMaxScroll);
      const same = scrollWidth === lastScrollWidth && maxScroll === lastMaxScroll && pages === lastPages;

      stableFrames = same ? stableFrames + 1 : 0;
      lastScrollWidth = scrollWidth;
      lastMaxScroll = maxScroll;
      lastPages = pages;
      totalPages = pages;

      if (stableFrames >= 1) return pages;
    }

    return lastPages > 0 ? lastPages : measureTotalPages();
  }

  function pageScrollFor(page: number): number {
    return Math.min(page * pageSize(), contentMaxScroll);
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
    currentPage = Math.max(0, Math.min(totalPages - 1, raw));
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

  function handleContentClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return;

    const link = e.target.closest<HTMLAnchorElement>("a[data-epub-href]");
    const href = link?.dataset.epubHref;
    if (!href) return;

    e.preventDefault();
    onNavigateHref(href);
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
    if (!el) return;

    el.addEventListener("click", handleContentClick);
    return () => el.removeEventListener("click", handleContentClick);
  });

  $effect(() => {
    const el = contentEl;
    if (!content || !el) return;

    const run = layoutRun;

    queueMicrotask(async () => {
      syncPageGeometry();
      watchImages(el, run);
      await waitForInitialFonts();
      if (run !== layoutRun) return;

      charCount = getTotalChars(el);
      const pages = await waitForStableLayout(run);
      if (run !== layoutRun || !containerEl) return;

      initializing = true;
      if (startAtEnd) {
        currentPage = pages - 1;
        containerEl.scrollLeft = pageScrollFor(currentPage);
      } else {
        currentPage = 0;
        containerEl.scrollLeft = 0;
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
    --line-height: 1.86;
    --safe-top: clamp(24px, 3.4vh, 42px);
    --safe-bottom: clamp(32px, 5.2vh, 64px);
    --safe-left: clamp(320px, 27vw, 540px);
    --safe-right: clamp(150px, 11vw, 240px);
    --content-width: max(1px, calc(var(--page-width, 100vw) - var(--safe-left) - var(--safe-right)));
    --column-gap: calc(var(--safe-left) + var(--safe-right));
    --content-height: max(1px, calc(var(--page-height, 100vh) - var(--safe-top) - var(--safe-bottom)));

    box-sizing: border-box;
    height: 100%;
    width: var(--page-width, 100vw);
    min-width: var(--page-width, 100vw);
    writing-mode: vertical-rl;
    text-orientation: mixed;
    column-width: var(--content-width);
    column-gap: var(--column-gap);
    column-fill: auto;
    orphans: 1;
    widows: 1;
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
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

  .rct :global(.main),
  .rct :global(.epub-body),
  .rct :global(.calibre) {
    display: block;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
  }

  .rct :global(.main:has(> .inline-height)) {
    height: var(--content-height);
  }

  .rct :global(a) {
    color: inherit;
    text-decoration: none;
  }

  .rct :global(.align-center) {
    display: block;
    text-align: center;
    text-indent: 0;
    margin: 0;
    padding: 0;
  }

  .rct :global(.align-right) {
    display: block;
    text-align: right;
    text-indent: 0;
    margin: 0;
    padding: 0;
  }

  .rct :global(.bold) {
    font-size: 1.29167em;
    font-weight: bold;
  }

  .rct :global(.font-090per) {
    font-size: 0.83333em;
  }

  .rct :global(.font-120per),
  .rct :global(.gfont) {
    font-size: 1.29167em;
  }

  .rct :global(.h-valign-width) {
    writing-mode: horizontal-tb;
    display: inline-block;
    width: 100%;
    vertical-align: middle;
  }

  .rct :global(.h-valign-width:empty) {
    display: none;
  }

  .rct :global(.inline-height) {
    display: inline-block;
    width: auto;
    height: 100%;
    text-indent: 0;
    vertical-align: middle;
    margin: 0;
    padding: 0;
  }

  .rct :global(.inline-width) {
    display: inline-block;
    width: 100%;
    height: auto;
    text-indent: 0;
    vertical-align: middle;
    margin: 0;
    padding: 0;
  }

  .rct :global(.m-bottom-030per) {
    display: block;
    width: auto;
    height: auto;
    text-indent: 0;
    margin: 0 0 30%;
    padding: 0;
  }

  .rct :global(.h-indent-1em) {
    display: block;
    text-indent: -1em;
    margin: 0;
    padding: 1em 0 0;
  }

  .rct :global(.h-indent-2em) {
    display: block;
    text-indent: -2em;
    margin: 0;
    padding: 2em 0 0;
  }

  .rct :global(.h-indent-2em1) {
    display: block;
    text-indent: -2em;
    margin: 0;
    padding: 0 0 0 2em;
  }

  .rct :global(.h-indent-4em) {
    display: block;
    text-indent: -4em;
    margin: 0;
    padding: 4em 0 0;
  }

  .rct :global(.h-indent-6em) {
    display: block;
    text-indent: -6em;
    margin: 0;
    padding: 6em 0 0;
  }

  .rct :global(.h-indent-7em) {
    display: block;
    text-indent: -7em;
    margin: 0;
    padding: 7em 0 0;
  }

  .rct :global(img) {
    max-width: 100%;
    max-height: var(--content-height, 80vh);
    object-fit: contain;
  }

  .rct :global(img.gaiji) {
    display: inline-block;
    width: 1em;
    height: 1em;
    max-width: 1em !important;
    max-height: 1em !important;
    margin: 0;
    padding: 0;
    vertical-align: baseline;
  }

  .rct :global(img.gaiji-line) {
    display: inline-block;
    width: 1em;
    height: auto;
    max-width: 1em !important;
    max-height: none;
    margin: 0;
    padding: 0;
    vertical-align: baseline;
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
