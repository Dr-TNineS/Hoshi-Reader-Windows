<script lang="ts">
  import { countChars, createWalker, getTotalChars, rawOffsetForReaderChars, textEndOffsets } from "../reader";
  import type { ReaderAppearancePalette } from "../appearance";
  import type { ReaderProgress, ReaderSelection, ReaderSelectionRect } from "../types";

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
    initialProgress = 0,
    chapterStartChars = 0,
    totalBookChars = 0,
    appearancePalette = undefined as ReaderAppearancePalette | undefined,
    onProgressChange = (_progress: ReaderProgress) => {},
    onSelectionChange = (_selection: ReaderSelection | null) => {},
  } = $props();

  const PAGE_EPSILON = 1;
  const MAX_SELECTION_TEXT = 80;
  const MAX_HOVER_SELECTION_TEXT = 16;
  const SHIFT_HOVER_DELAY_MS = 45;
  const SHIFT_HOVER_MOVE_THRESHOLD_SQUARED = 64;
  const SCAN_BOUNDARY_PATTERN = /[\s\u3000\u3001\u3002\uff01\uff1f\uff08\uff09\u300c\u300d\u300e\u300f\u3010\u3011\u2014\u2026.,!?;:()[\]{}"'<>/\\|]/u;

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
  let bookReadChars = $state(0);
  let bookPercent = $state(0);
  let scrollTailTop = $state(0);
  let hasActiveSelection = false;
  let shiftKeyPressed = false;
  let lastPointer: { x: number; y: number } | null = null;
  let lastShiftHoverPoint: { x: number; y: number } | null = null;
  let lastLookupSelectionKey = "";
  let shiftHoverTimer: number | null = null;
  let layoutRun = 0;
  let resizeRun = 0;
  let contentMaxScroll = 0;

  let styleVars = $derived(`--page-width:${pageWidth}px;--page-height:${pageHeight}px`);
  let themeVars = $derived(appearancePalette
    ? `--reader-bg:${appearancePalette.readerBackground};--reader-text:${appearancePalette.readerText};--reader-info:${appearancePalette.readerInfo};--app-border:${appearancePalette.appBorder}`
    : "");

  function readerDebugEnabled(): boolean {
    return typeof localStorage !== "undefined" && localStorage.getItem("hoshi_reader_debug") === "1";
  }

  function pageSize(): number {
    return containerEl?.clientHeight || window.innerHeight;
  }

  function scrollLimit(): number {
    const ps = pageSize();
    return Math.max(0, (containerEl?.scrollHeight || ps) - ps);
  }

  function contentScrollLimit(): number {
    const ps = pageSize();
    return Math.max(0, (contentEl?.scrollHeight || ps) - ps);
  }

  function logicalScrollPos(): number {
    if (!containerEl) return 0;
    return Math.min(scrollLimit(), Math.max(0, containerEl.scrollTop));
  }

  function setLogicalScrollPos(value: number): number {
    if (!containerEl) return 0;

    const target = Math.max(0, Math.min(value, contentMaxScroll));
    containerEl.scrollTop = target;
    return logicalScrollPos();
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
    return Math.max(1, Math.round(contentMaxScroll / ps) + 1);
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

  function textNodes(): Text[] {
    if (!contentEl) return [];

    const walker = createWalker(contentEl);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.textContent?.trim()) nodes.push(node);
    }
    return nodes;
  }

  function rangeRectsForText(node: Text, endOffset: number): DOMRect[] {
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.max(0, Math.min(endOffset, node.length)));
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    range.detach();
    return rects;
  }

  function rectsBeforeViewport(rects: DOMRect[], viewportTop: number): boolean {
    return rects.length > 0 && Math.max(...rects.map((rect) => rect.bottom)) <= viewportTop + PAGE_EPSILON;
  }

  function rectsAfterViewport(rects: DOMRect[], viewportTop: number): boolean {
    return rects.length > 0 && Math.min(...rects.map((rect) => rect.top)) >= viewportTop - PAGE_EPSILON;
  }

  function countTextBeforeViewport(node: Text, viewportTop: number): number {
    const text = node.textContent || "";
    const total = countChars(text);
    if (total === 0) return 0;

    const fullRects = rangeRectsForText(node, node.length);
    if (rectsBeforeViewport(fullRects, viewportTop)) return total;
    if (rectsAfterViewport(fullRects, viewportTop)) return 0;

    const offsets = textEndOffsets(text);
    let lo = 0;
    let hi = offsets.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const rects = rangeRectsForText(node, offsets[mid - 1]);
      if (rectsBeforeViewport(rects, viewportTop)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function chapterCharsBeforeViewport(): number {
    if (!containerEl || !contentEl) return 0;
    const viewportTop = containerEl.getBoundingClientRect().top;
    return textNodes().reduce((total, node) => total + countTextBeforeViewport(node, viewportTop), 0);
  }

  function scrollForChapterProgress(progress: number): number {
    if (!containerEl || !contentEl || charCount <= 0) return 0;
    const target = Math.max(0, Math.min(charCount, Math.floor(charCount * Math.max(0, Math.min(progress, 1)))));
    if (target <= 0) return 0;
    if (target >= charCount) return contentMaxScroll;

    let seen = 0;
    for (const node of textNodes()) {
      const text = node.textContent || "";
      const nodeChars = countChars(text);
      if (seen + nodeChars < target) {
        seen += nodeChars;
        continue;
      }

      const rawOffset = rawOffsetForReaderChars(text, target - seen);
      const rects = rangeRectsForText(node, rawOffset);
      const targetRect = rects.at(-1);
      if (!targetRect) return 0;

      const viewportTop = containerEl.getBoundingClientRect().top;
      const logicalBottom = targetRect.bottom - viewportTop + logicalScrollPos();
      return Math.ceil(Math.max(0, logicalBottom - PAGE_EPSILON) / pageSize()) * pageSize();
    }

    return contentMaxScroll;
  }

  function emitProgress() {
    if (!layoutReady || !contentEl) return;
    const chapterReadChars = Math.max(0, Math.min(charCount, chapterCharsBeforeViewport()));
    const total = Math.max(0, totalBookChars || 0);
    bookReadChars = Math.max(0, Math.min(total || chapterStartChars + charCount, chapterStartChars + chapterReadChars));
    bookPercent = total > 0 ? (bookReadChars / total) * 100 : 0;
    onProgressChange({
      chapterIndex,
      chapterProgress: charCount > 0 ? chapterReadChars / charCount : 0,
      chapterReadChars,
      bookReadChars,
      totalBookChars: total,
      percent: bookPercent,
    });
  }

  function scheduleProgressEmit() {
    requestAnimationFrame(() => emitProgress());
  }

  function measureContentMaxScroll(): number {
    const ps = pageSize();
    if (ps <= 0) return 0;

    const rawLimit = contentScrollLimit();
    const alignedLimit = Math.ceil(Math.max(0, rawLimit - PAGE_EPSILON) / ps) * ps;
    const nextScrollTailTop = alignedLimit > rawLimit ? ps + alignedLimit : 0;
    if (Math.abs(nextScrollTailTop - scrollTailTop) > 0.5) {
      scrollTailTop = nextScrollTailTop;
    }
    return alignedLimit;
  }

  function readableTextRects(): { first: DOMRect | null; last: DOMRect | null } {
    const nodes = textNodes();

    function rectFor(node: Text, side: "first" | "last"): DOMRect | null {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      const rect = side === "first" ? rects[0] : rects.at(-1);
      range.detach();
      return rect ?? null;
    }

    return {
      first: nodes.length ? rectFor(nodes[0], "first") : null,
      last: nodes.length ? rectFor(nodes[nodes.length - 1], "last") : null,
    };
  }

  function rectSnapshot(rect: DOMRect | null) {
    if (!rect) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    };
  }

  function selectionText(raw: string): string {
    return raw.replace(/\s+/g, " ").trim().slice(0, MAX_SELECTION_TEXT);
  }

  function nodeInsideContent(node: Node | null): boolean {
    if (!node || !contentEl) return false;
    return contentEl.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  }

  function unionRects(rects: DOMRect[]): ReaderSelectionRect | null {
    const visibleRects = rects.filter((rect) => rect.width > 0 && rect.height > 0);
    if (visibleRects.length === 0) return null;

    const left = Math.min(...visibleRects.map((rect) => rect.left));
    const top = Math.min(...visibleRects.map((rect) => rect.top));
    const right = Math.max(...visibleRects.map((rect) => rect.right));
    const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  function isScanBoundary(char: string): boolean {
    return SCAN_BOUNDARY_PATTERN.test(char);
  }

  function isJapaneseCodePoint(codePoint: number | undefined): boolean {
    if (codePoint === undefined) return false;
    return (
      (codePoint >= 0x3040 && codePoint <= 0x309f) ||
      (codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xff66 && codePoint <= 0xff9f)
    );
  }

  function previousCodePointOffset(text: string, offset: number): number {
    if (offset <= 0) return 0;
    const first = offset - 1;
    const previous = text.charCodeAt(first);
    if (first > 0 && previous >= 0xdc00 && previous <= 0xdfff) {
      const lead = text.charCodeAt(first - 1);
      if (lead >= 0xd800 && lead <= 0xdbff) return first - 1;
    }
    return first;
  }

  function expandTokenStart(text: string, offset: number): number {
    const codePoint = text.codePointAt(offset);
    if (isJapaneseCodePoint(codePoint)) return offset;

    let start = offset;
    while (start > 0) {
      const previous = previousCodePointOffset(text, start);
      const char = String.fromCodePoint(text.codePointAt(previous) ?? 0);
      if (isScanBoundary(char) || isJapaneseCodePoint(text.codePointAt(previous))) break;
      start = previous;
    }
    return start;
  }

  function rectContains(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function rangeContainsPoint(range: Range, x: number, y: number): boolean {
    const rects = Array.from(range.getClientRects());
    if (rects.length > 0) return rects.some((rect) => rectContains(rect, x, y));
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rectContains(rect, x, y);
  }

  function caretRangeFromPoint(x: number, y: number): Range | null {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }

    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) return range;

    const target = document.elementFromPoint(x, y);
    const root = target?.closest("p, div, span, ruby") ?? contentEl;
    if (!root || !contentEl?.contains(root)) return null;

    const walker = createWalker(root);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      for (let offset = 0; offset < text.length;) {
        const char = String.fromCodePoint(text.codePointAt(offset) ?? 0);
        const end = Math.min(text.length, offset + char.length);
        const charRange = document.createRange();
        charRange.setStart(node, offset);
        charRange.setEnd(node, end);
        const hit = rangeContainsPoint(charRange, x, y);
        charRange.detach();
        if (hit) {
          const collapsed = document.createRange();
          collapsed.setStart(node, offset);
          collapsed.collapse(true);
          return collapsed;
        }
        offset = end;
      }
    }

    return null;
  }

  function rectSnapshotFromDomRect(rect: DOMRect): ReaderSelectionRect {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  function characterAtPoint(x: number, y: number): { node: Text; offset: number; rect: ReaderSelectionRect } | null {
    const range = caretRangeFromPoint(x, y);
    if (!range) return null;

    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !nodeInsideContent(node)) return null;

    const textNode = node as Text;
    const text = textNode.textContent ?? "";
    const caret = range.startOffset;

    for (const offset of [caret, caret - 1, caret + 1]) {
      if (offset < 0 || offset >= text.length) continue;

      const char = String.fromCodePoint(text.codePointAt(offset) ?? 0);
      const charRange = document.createRange();
      charRange.setStart(textNode, offset);
      charRange.setEnd(textNode, Math.min(text.length, offset + char.length));
      const hit = rangeContainsPoint(charRange, x, y);
      const anchorDomRect = Array.from(charRange.getClientRects()).find((rect) => rectContains(rect, x, y))
        ?? charRange.getBoundingClientRect();
      charRange.detach();

      if (hit && !isScanBoundary(char) && anchorDomRect.width > 0 && anchorDomRect.height > 0) {
        return { node: textNode, offset, rect: rectSnapshotFromDomRect(anchorDomRect) };
      }
    }

    return null;
  }

  function paragraphRoot(node: Node): Node {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    return element?.closest("p, div, section, article") ?? contentEl;
  }

  function selectTextFromPoint(x: number, y: number): ReaderSelection | null {
    if (!contentEl) return null;
    const target = document.elementFromPoint(x, y);
    if (target instanceof Element && contentEl.contains(target) && target.closest("a[data-epub-href], img, image, svg")) {
      clearSelection();
      return null;
    }

    const hit = characterAtPoint(x, y);
    if (!hit) {
      return null;
    }

    const root = paragraphRoot(hit.node);
    const walker = createWalker(root);
    walker.currentNode = hit.node;

    let text = "";
    let node: Text | null = hit.node;
    let offset = expandTokenStart(hit.node.textContent ?? "", hit.offset);
    const ranges: Range[] = [];

    while (node && text.length < MAX_HOVER_SELECTION_TEXT) {
      const content = node.textContent ?? "";
      const start = offset;

      while (offset < content.length && text.length < MAX_HOVER_SELECTION_TEXT) {
        const char = String.fromCodePoint(content.codePointAt(offset) ?? 0);
        if (isScanBoundary(char)) break;
        text += char;
        offset += char.length;
      }

      if (offset > start) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, offset);
        ranges.push(range);
      }

      if (offset < content.length || text.length >= MAX_HOVER_SELECTION_TEXT) break;

      const next = walker.nextNode();
      node = next?.nodeType === Node.TEXT_NODE ? next as Text : null;
      offset = 0;
    }

    text = selectionText(text);
    if (!text || ranges.length === 0) {
      return null;
    }

    const visibleSelection = window.getSelection();
    visibleSelection?.removeAllRanges();
    const visibleRange = document.createRange();
    visibleRange.setStart(ranges[0].startContainer, ranges[0].startOffset);
    const lastRange = ranges[ranges.length - 1];
    visibleRange.setEnd(lastRange.endContainer, lastRange.endOffset);
    visibleSelection?.addRange(visibleRange);

    const rect = unionRects(ranges.flatMap((range) => Array.from(range.getClientRects())));
    ranges.forEach((range) => range.detach());
    visibleRange.detach();
    if (!rect) {
      return null;
    }

    const anchorRect = hit.rect;
    const selectionKey = `${chapterIndex}:${text}:${Math.round(anchorRect.x)}:${Math.round(anchorRect.y)}`;
    const selection = { text, rect, anchorRect, chapterIndex };
    if (selectionKey === lastLookupSelectionKey) return selection;

    lastLookupSelectionKey = selectionKey;
    hasActiveSelection = true;
    onSelectionChange(selection);
    return selection;
  }

  function clearSelection() {
    if (shiftHoverTimer !== null) {
      window.clearTimeout(shiftHoverTimer);
      shiftHoverTimer = null;
    }
    window.getSelection()?.removeAllRanges();
    hasActiveSelection = false;
    lastLookupSelectionKey = "";
    onSelectionChange(null);
  }

  function clearShiftHoverTimer() {
    if (shiftHoverTimer === null) return;
    window.clearTimeout(shiftHoverTimer);
    shiftHoverTimer = null;
  }

  function resetShiftHoverState() {
    clearShiftHoverTimer();
    lastShiftHoverPoint = null;
  }

  function leaveReaderPointerState() {
    lastPointer = null;
    resetShiftHoverState();
  }

  function shouldScheduleShiftHoverLookup(point: { x: number; y: number }): boolean {
    if (!lastShiftHoverPoint) {
      lastShiftHoverPoint = point;
      return true;
    }

    const dx = point.x - lastShiftHoverPoint.x;
    const dy = point.y - lastShiftHoverPoint.y;
    if (dx * dx + dy * dy < SHIFT_HOVER_MOVE_THRESHOLD_SQUARED) return false;

    lastShiftHoverPoint = point;
    return true;
  }

  function scheduleShiftHoverLookup() {
    if (!shiftKeyPressed || !lastPointer) return;
    clearShiftHoverTimer();
    shiftHoverTimer = window.setTimeout(() => {
      shiftHoverTimer = null;
      if (!shiftKeyPressed || !lastPointer) return;
      selectTextFromPoint(lastPointer.x, lastPointer.y);
    }, SHIFT_HOVER_DELAY_MS);
  }

  function logReaderGeometry(reason: string) {
    if (!readerDebugEnabled() || !containerEl || !contentEl) return;

    const textRects = readableTextRects();
    console.table({
      reason,
      chapter: chapterIndex + 1,
      currentPage: currentPage + 1,
      totalPages,
      pageSize: pageSize(),
      clientWidth: containerEl.clientWidth,
      clientHeight: containerEl.clientHeight,
      scrollTop: Math.round(containerEl.scrollTop),
      scrollHeight: containerEl.scrollHeight,
      contentScrollHeight: contentEl.scrollHeight,
      contentMaxScroll: Math.round(contentMaxScroll),
      scrollTailTop: Math.round(scrollTailTop),
      contentRect: JSON.stringify(rectSnapshot(contentEl.getBoundingClientRect())),
      firstTextRect: JSON.stringify(rectSnapshot(textRects.first)),
      lastTextRect: JSON.stringify(rectSnapshot(textRects.last)),
    });
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
      const scrollHeight = Math.round(containerEl.scrollHeight);
      const maxScroll = Math.round(contentMaxScroll);
      const same = scrollHeight === lastScrollWidth && maxScroll === lastMaxScroll && pages === lastPages;

      stableFrames = same ? stableFrames + 1 : 0;
      lastScrollWidth = scrollHeight;
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
    clearSelection();
    currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const scrollTarget = pageScrollFor(currentPage);
    lastSnappedScroll = scrollTarget;
    setLogicalScrollPos(scrollTarget);
    scheduleProgressEmit();
  }

  async function realignAfterResize() {
    if (!containerEl || !contentEl) return;

    const run = ++resizeRun;
    const activeRun = layoutRun;
    const targetPage = currentPage;
    const wasReady = layoutReady;

    syncPageGeometry();
    if (!wasReady) {
      recalc();
      return;
    }

    initializing = true;
    await waitFrame();
    await waitFrame();
    if (run !== resizeRun || activeRun !== layoutRun || !containerEl) return;

    const pages = await waitForStableLayout(activeRun);
    if (run !== resizeRun || activeRun !== layoutRun || !containerEl) return;

    totalPages = pages;
    currentPage = Math.max(0, Math.min(targetPage, totalPages - 1));
    const scrollTarget = pageScrollFor(currentPage);
    lastSnappedScroll = scrollTarget;
    setLogicalScrollPos(scrollTarget);

    await waitFrame();
    if (run !== resizeRun || activeRun !== layoutRun || !containerEl) return;
    initializing = false;
    logReaderGeometry("resize-realign");
    scheduleProgressEmit();
  }

  function nextPage() {
    if (currentPage < totalPages - 1) {
      goPage(currentPage + 1);
      return;
    }

    onNextChapter();
  }

  function prevPage() {
    if (currentPage > 0) {
      goPage(currentPage - 1);
      return;
    }

    onPrevChapter();
  }

  function onScroll() {
    if (!containerEl || initializing) return;
    const ps = pageSize();
    if (ps <= 0) return;

    const currentScroll = logicalScrollPos();
    const snappedScroll = Math.round(currentScroll / ps) * ps;

    if (Math.abs(currentScroll - snappedScroll) > 1) {
      setLogicalScrollPos(lastSnappedScroll);
      return;
    }

    lastSnappedScroll = snappedScroll;
    const raw = Math.round(currentScroll / ps);
    currentPage = Math.max(0, Math.min(totalPages - 1, raw));
    scheduleProgressEmit();
  }

  function handleKey(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "Shift") {
      shiftKeyPressed = true;
    } else if (ctrl && e.key === "ArrowLeft") {
      e.preventDefault();
      onNextChapter();
    } else if (ctrl && e.key === "ArrowRight") {
      e.preventDefault();
      onPrevChapterDirect();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      prevPage();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nextPage();
    } else if (e.key === "Escape") {
      if (hasActiveSelection) {
        e.preventDefault();
        clearSelection();
        return;
      }
      onBackToShelf();
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.key !== "Shift") return;
    shiftKeyPressed = false;
    resetShiftHoverState();
  }

  function handleContentClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return;

    const link = e.target.closest<HTMLAnchorElement>("a[data-epub-href]");
    const href = link?.dataset.epubHref;
    if (!href) return;

    e.preventDefault();
    onNavigateHref(href);
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.target instanceof Element && e.target.closest("a[data-epub-href]")) return;
    if (hasActiveSelection) clearSelection();
  }

  function handlePointerMove(e: PointerEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    shiftKeyPressed = e.shiftKey;
    if (e.shiftKey) {
      if (shouldScheduleShiftHoverLookup(lastPointer)) scheduleShiftHoverLookup();
    } else {
      resetShiftHoverState();
    }
  }

  function handleWindowBlur() {
    shiftKeyPressed = false;
    leaveReaderPointerState();
  }

  function handleWheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

    e.preventDefault();
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.deltaY > 0) {
      if (ctrl) {
        onNextChapter();
        return;
      }
      nextPage();
    } else if (e.deltaY < 0) {
      if (ctrl) {
        onPrevChapterDirect();
        return;
      }
      prevPage();
    }
  }

  $effect.pre(() => {
    if (content !== activeContent) {
      activeContent = content;
      layoutReady = false;
      initializing = true;
      scrollTailTop = 0;
      clearSelection();
      lastPointer = null;
      resetShiftHoverState();
      layoutRun += 1;
    }
  });


  $effect(() => {
    const el = containerEl;
    if (!el) return;

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  });
  $effect(() => {
    const content = contentEl;
    const viewport = containerEl;
    if (!content || !viewport) return;

    content.addEventListener("click", handleContentClick);
    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerleave", leaveReaderPointerState);
    return () => {
      content.removeEventListener("click", handleContentClick);
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerleave", leaveReaderPointerState);
      handleWindowBlur();
    };
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
        setLogicalScrollPos(pageScrollFor(currentPage));
      } else {
        const restoredScroll = scrollForChapterProgress(initialProgress);
        currentPage = Math.max(0, Math.min(totalPages - 1, Math.round(restoredScroll / pageSize())));
        setLogicalScrollPos(pageScrollFor(currentPage));
      }

      await waitFrame();
      if (run !== layoutRun || !containerEl) return;
      initializing = false;
      lastSnappedScroll = logicalScrollPos();
      layoutReady = true;
      logReaderGeometry("layout-ready");
      emitProgress();
    });

    const ro = new ResizeObserver(() => {
      realignAfterResize();
    });
    // Content changes are handled by the chapter/image layout path above.
    // Observe only the viewport so tail padding cannot trigger a resize loop.
    if (containerEl) ro.observe(containerEl);

    return () => ro.disconnect();
  });
</script>

<svelte:window onkeydown={handleKey} onkeyup={handleKeyUp} onblur={handleWindowBlur} />

<div class="rc" style={themeVars}>
  <div class="rh">
    <span>
      Ch.{chapterIndex + 1}/{totalChapters} | P.{currentPage + 1}/{totalPages} |
      {bookReadChars}/{totalBookChars || charCount}c | {bookPercent.toFixed(2)}%
    </span>
  </div>

  <div bind:this={containerEl} class="rv" class:ready={layoutReady} onscroll={onScroll}>
    <div bind:this={contentEl} class="rct" style={styleVars}>
      {@html content}
    </div>
    {#if scrollTailTop > 0}
      <div class="scroll-tail" style={`top:${scrollTailTop}px`} aria-hidden="true"></div>
    {/if}
  </div>
</div>

<style>
  .rc {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--reader-bg, #000);
    color: var(--reader-text, #fff);
  }

  .rh {
    display: flex;
    align-items: center;
    padding: 3px 10px;
    font-size: 10px;
    color: var(--reader-info, #999999);
    background: var(--reader-bg, #000);
    border-bottom: 1px solid var(--app-border, #333333);
    flex-shrink: 0;
    user-select: none;
  }

  .rv {
    flex: 1;
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .rv:not(.ready) {
    opacity: 0;
  }

  .rv.ready {
    opacity: 1;
  }

  .scroll-tail {
    position: absolute;
    left: 0;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
    pointer-events: none;
  }

  .rct {
    --font-size: 22px;
    --line-height: 1.65;
    --safe-top: clamp(24px, 3.4vh, 42px);
    --safe-bottom: clamp(32px, 5.2vh, 64px);
    --safe-left: clamp(40px, 2.5vw, 72px);
    --safe-right: clamp(40px, 2.5vw, 72px);
    --content-height: max(1px, calc(var(--page-height, 100vh) - var(--safe-top) - var(--safe-bottom)));
    --column-gap: calc(var(--safe-top) + var(--safe-bottom));

    box-sizing: border-box;
    min-height: 100%;
    width: var(--page-width, 100vw);
    min-width: var(--page-width, 100vw);
    writing-mode: vertical-rl;
    text-orientation: mixed;
    column-width: var(--content-height);
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
    background: var(--reader-bg, #000);
    color: var(--reader-text, #fff);
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

  .rct :global(img.epub-svg-cover-img) {
    display: block;
    width: auto;
    height: var(--content-height, 80vh);
    max-width: 100% !important;
    max-height: var(--content-height, 80vh) !important;
    object-fit: contain;
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
