<script lang="ts">
  import { untrack } from "svelte";
  import { countChars, createWalker, getTotalChars, isVertical, rawOffsetForReaderChars, readerCharOffsetForRange, readerRangeForOffsets, textEndOffsets } from "../reader";
  import type { ReaderAppearancePalette } from "../appearance";
  import {
    clearLookupHighlight,
    READER_LOOKUP_HIGHLIGHT,
    READER_SASAYAKI_HIGHLIGHT,
  } from "../lookup-highlight";
  import type { ReaderProgress, ReaderSelection, ReaderSelectionRect, SasayakiPlaybackCue } from "../types";

  let {
    content = "",
    chapterIndex = 0,
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
    lookupHighlightCount = 0,
    lookupHighlightSignal = 0,
    sasayakiCue = null as SasayakiPlaybackCue | null,
    sasayakiReveal = false,
    sasayakiCueSignal = 0,
    scanLength = 16,
    scanNonJapaneseText = true,
    onProgressChange = (_progress: ReaderProgress) => {},
    onSelectionChange = (_selection: ReaderSelection | null) => {},
  } = $props();

  const PAGE_EPSILON = 1;
  const MAX_SELECTION_TEXT = 80;
  const MAX_SENTENCE_CONTEXT_TEXT = 1200;
  const SCAN_BOUNDARY_PATTERN = /[\s\u3000\u3001\u3002\uff01\uff1f\uff08\uff09\u300c\u300d\u300e\u300f\u3010\u3011\u2014\u2026.,!?;:()[\]{}"'<>/\\|]/u;
  const SENTENCE_DELIMITERS = "。！？.!?\n\r";
  const TRAILING_SENTENCE_CHARS = "。、！？…‥」』）)】〉》〕｝}］]";
  const SENTENCE_BRACKETS: Record<string, string> = {
    "「": "」",
    "『": "』",
    "（": "）",
    "(": ")",
    "【": "】",
    "〈": "〉",
    "《": "》",
    "〔": "〕",
    "｛": "｝",
    "{": "}",
    "［": "］",
    "[": "]",
  };

  type ViewportRect = { x: number; y: number; width: number; height: number };
  type BoundsRect = ViewportRect & { left: number; top: number; right: number; bottom: number };
  type RectLike = Partial<ViewportRect & { left: number; top: number; right: number; bottom: number }>;
  type OverlayRect = { left: number; top: number; width: number; height: number };

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
  let pointerDownPoint: { x: number; y: number } | null = null;
  let lastShiftHoverHit: { node: Text; offset: number } | null = null;
  let lastAppliedLookupHighlightCount = -1;
  let activeLookupRanges: Range[] = [];
  let shiftHoverFrame: number | null = null;
  let layoutRun = 0;
  let resizeRun = 0;
  let contentMaxScroll = 0;
  let lookupHighlightRects = $state<OverlayRect[]>([]);
  let lookupHighlightText = $state("");
  let sasayakiHighlightRects = $state<OverlayRect[]>([]);
  let sasayakiHighlightText = $state("");

  let styleVars = $derived(`--page-width:${pageWidth}px;--page-height:${pageHeight}px`);
  let themeVars = $derived(appearancePalette
    ? `--reader-bg:${appearancePalette.readerBackground};--reader-text:${appearancePalette.readerText};--reader-info:${appearancePalette.readerInfo};--lookup-highlight-color:${appearancePalette.lookupHighlight};--sasayaki-highlight-text:${appearancePalette.sasayakiHighlightText};--sasayaki-highlight-background:${appearancePalette.sasayakiHighlightBackground};--app-border:${appearancePalette.appBorder}`
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
    return raw.replace(/\s+/g, " ").trim().slice(0, Math.min(MAX_SELECTION_TEXT, lookupScanLength()));
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

  function lookupScanLength(): number {
    if (!Number.isFinite(scanLength)) return 16;
    return Math.min(64, Math.max(1, Math.round(scanLength)));
  }

  function canScanCodePoint(codePoint: number | undefined): boolean {
    return scanNonJapaneseText || isJapaneseCodePoint(codePoint);
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

      if (
        hit &&
        !isScanBoundary(char) &&
        canScanCodePoint(text.codePointAt(offset)) &&
        anchorDomRect.width > 0 &&
        anchorDomRect.height > 0
      ) {
        return { node: textNode, offset, rect: rectSnapshotFromDomRect(anchorDomRect) };
      }
    }

    return null;
  }

  function paragraphRoot(node: Node): Node {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    return element?.closest("p, li, blockquote, div, section, article") ?? contentEl;
  }

  function trimSentenceContext(rawSentence: string, rawSelectedOffset: number): { sentence: string; sentenceOffset?: number } {
    const leadingTrim = rawSentence.length - rawSentence.trimStart().length;
    let selectedOffset = Math.max(0, rawSelectedOffset - leadingTrim);
    const sentence = rawSentence.trim().slice(0, MAX_SENTENCE_CONTEXT_TEXT);

    const closeBrackets = new Set(Object.values(SENTENCE_BRACKETS));
    const openBrackets = new Set(Object.keys(SENTENCE_BRACKETS));
    const stack: string[] = [];
    const unmatchedClose: string[] = [];

    for (const ch of sentence) {
      if (openBrackets.has(ch)) {
        stack.push(ch);
      } else if (closeBrackets.has(ch)) {
        if (stack.length > 0 && SENTENCE_BRACKETS[stack[stack.length - 1]] === ch) {
          stack.pop();
        } else {
          unmatchedClose.push(ch);
        }
      }
    }

    let startSlice = 0;
    while (stack.length > 0 && startSlice < sentence.length - 1) {
      if (stack[0] === sentence[startSlice]) {
        stack.shift();
      } else {
        break;
      }
      startSlice += 1;
    }

    let endSlice = sentence.length - 1;
    let endIdx = sentence.length - 1;
    while (unmatchedClose.length > 0 && endIdx > startSlice) {
      if (unmatchedClose[unmatchedClose.length - 1] === sentence[endIdx]) {
        unmatchedClose.pop();
        endSlice = endIdx - 1;
      } else if (!SENTENCE_DELIMITERS.includes(sentence[endIdx])) {
        break;
      }
      endIdx -= 1;
    }

    const sliced = sentence.slice(startSlice, endSlice + 1);
    const slicedLeadingTrim = sliced.length - sliced.trimStart().length;
    selectedOffset = Math.max(0, selectedOffset - startSlice - slicedLeadingTrim);
    const trimmed = sliced.trim();
    return {
      sentence: trimmed,
      ...(selectedOffset >= 0 && selectedOffset < trimmed.length ? { sentenceOffset: selectedOffset } : {}),
    };
  }

  function sentenceContext(root: Node, range: Range): { sentence: string; sentenceOffset?: number } {
    const startNode = range.startContainer;
    if (startNode.nodeType !== Node.TEXT_NODE) {
      return { sentence: selectionText(root.textContent ?? "") };
    }

    const walker = createWalker(root);
    walker.currentNode = startNode;
    const partsBefore: string[] = [];
    let node: Node | null = startNode;
    let limit = range.startOffset;

    while (node) {
      const text = node.textContent ?? "";
      let foundStart = false;
      for (let i = limit - 1; i >= 0; i -= 1) {
        if (SENTENCE_DELIMITERS.includes(text[i])) {
          partsBefore.push(text.slice(i + 1, limit));
          foundStart = true;
          break;
        }
      }

      if (foundStart) break;

      partsBefore.push(text.slice(0, limit));
      node = walker.previousNode();
      if (node) limit = node.textContent?.length ?? 0;
    }

    walker.currentNode = startNode;
    const partsAfter: string[] = [];
    node = startNode;
    let start = range.startOffset;

    while (node) {
      const text = node.textContent ?? "";
      let foundEnd = false;

      for (let i = start; i < text.length; i += 1) {
        if (SENTENCE_DELIMITERS.includes(text[i])) {
          let end = i + 1;
          while (end < text.length) {
            if (!TRAILING_SENTENCE_CHARS.includes(text[end])) break;
            end += 1;
          }
          partsAfter.push(text.slice(start, end));
          foundEnd = true;
          break;
        }
      }

      if (foundEnd) break;

      partsAfter.push(text.slice(start));
      node = walker.nextNode();
      start = 0;
    }

    const beforeText = partsBefore.reverse().join("");
    const rawSentence = beforeText + partsAfter.join("");
    const context = trimSentenceContext(rawSentence, beforeText.length);
    if (context.sentence) return context;
    return { sentence: selectionText(root.textContent ?? "") };
  }

  function detachActiveLookupRange() {
    activeLookupRanges.forEach((range) => range.detach());
    activeLookupRanges = [];
    lastAppliedLookupHighlightCount = -1;
    lookupHighlightRects = [];
    lookupHighlightText = "";
    clearLookupHighlight(READER_LOOKUP_HIGHLIGHT);
  }

  function lookupCharacterRanges(characterCount: number): Range[] {
    if (characterCount <= 0) return [];
    const characterRanges: Range[] = [];
    let remaining = characterCount;

    for (const sourceRange of activeLookupRanges) {
      if (remaining <= 0) break;
      if (!sourceRange.startContainer.parentElement?.isConnected) continue;
      if (sourceRange.startContainer.nodeType !== Node.TEXT_NODE || sourceRange.endContainer.nodeType !== Node.TEXT_NODE) continue;

      const node = sourceRange.startContainer as Text;
      const content = node.textContent ?? "";
      const startOffset = sourceRange.startOffset;
      const endOffset = sourceRange.endOffset;
      let offset = startOffset;
      while (offset < endOffset && remaining > 0) {
        const char = String.fromCodePoint(content.codePointAt(offset) ?? 0);
        const nextOffset = Math.min(endOffset, offset + char.length);
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, nextOffset);
        characterRanges.push(range);
        remaining -= 1;
        offset = nextOffset;
      }
    }

    if (remaining === 0) return characterRanges;
    characterRanges.forEach((range) => range.detach());
    return [];
  }

  function readerContentIsVertical(): boolean {
    return contentEl ? isVertical(contentEl) : false;
  }

  function rectObject(rect: RectLike): ViewportRect {
    const x = rect.x ?? rect.left ?? 0;
    const y = rect.y ?? rect.top ?? 0;
    const width = rect.width ?? ((rect.right ?? x) - (rect.left ?? x));
    const height = rect.height ?? ((rect.bottom ?? y) - (rect.top ?? y));
    return { x, y, width, height };
  }

  function rectWithBounds(rect: RectLike): BoundsRect {
    const object = rectObject(rect);
    const left = rect.left ?? object.x;
    const top = rect.top ?? object.y;
    const right = rect.right ?? object.x + object.width;
    const bottom = rect.bottom ?? object.y + object.height;
    return { ...object, left, top, right, bottom };
  }

  function unionBoundsRect(a: BoundsRect, b: BoundsRect): BoundsRect {
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    const right = Math.max(a.right, b.right);
    const bottom = Math.max(a.bottom, b.bottom);
    return { x: left, y: top, width: right - left, height: bottom - top, left, top, right, bottom };
  }

  function rangeOverlapAmount(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  }

  function rangesSubstantiallyOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    const overlap = rangeOverlapAmount(aStart, aEnd, bStart, bEnd);
    const shorter = Math.min(aEnd - aStart, bEnd - bStart);
    return shorter > 0 && overlap > shorter / 2;
  }

  function rubyForNode(node: Node): Element | null {
    const element = node.nodeType === Node.TEXT_NODE
      ? (node as Text).parentElement
      : node instanceof Element ? node : null;
    return element?.closest("ruby") ?? null;
  }

  function rubyTextRects(node: Node): DOMRect[] {
    const ruby = rubyForNode(node);
    if (!ruby) return [];
    return Array.from(ruby.querySelectorAll("rt"))
      .flatMap((rt) => Array.from(rt.getClientRects()))
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }

  function rubyRectMatchesBase(baseRect: BoundsRect, rubyRect: DOMRect): boolean {
    const ruby = rectWithBounds(rubyRect);
    const minimumOverlap = 1;
    if (readerContentIsVertical()) {
      return rangeOverlapAmount(baseRect.top, baseRect.bottom, ruby.top, ruby.bottom) > minimumOverlap;
    }
    return rangeOverlapAmount(baseRect.left, baseRect.right, ruby.left, ruby.right) > minimumOverlap;
  }

  function rubyAwareRect(rect: DOMRect, node: Node): ViewportRect {
    const rubyRects = rubyTextRects(node);
    if (rubyRects.length === 0) return rectObject(rect);
    const base = rectWithBounds(rect);
    let result = base;
    for (const rubyRect of rubyRects) {
      if (rubyRectMatchesBase(base, rubyRect)) {
        result = unionBoundsRect(result, rectWithBounds(rubyRect));
      }
    }
    return rectObject(result);
  }

  function lookupRectsForRange(range: Range): ViewportRect[] {
    let rects = Array.from(range.getClientRects());
    if (rects.length === 0) {
      const fallback = range.getBoundingClientRect();
      if (fallback.width > 0 && fallback.height > 0) rects = [fallback];
    }
    return rects
      .map((rect) => rubyAwareRect(rect, range.startContainer))
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }

  function inlineRectsTouch(a: ViewportRect, b: ViewportRect): boolean {
    const tolerance = 0.5;
    if (readerContentIsVertical()) {
      return rangesSubstantiallyOverlap(a.x, a.x + a.width, b.x, b.x + b.width) &&
        b.y <= a.y + a.height + tolerance &&
        b.y + b.height >= a.y - tolerance;
    }
    return rangesSubstantiallyOverlap(a.y, a.y + a.height, b.y, b.y + b.height) &&
      b.x <= a.x + a.width + tolerance &&
      b.x + b.width >= a.x - tolerance;
  }

  function mergeLookupRects(rects: ViewportRect[]): ViewportRect[] {
    const merged: ViewportRect[] = [];
    for (const rect of rects) {
      const current = { ...rect };
      const previous = merged.at(-1);
      if (previous && inlineRectsTouch(previous, current)) {
        const left = Math.min(previous.x, current.x);
        const top = Math.min(previous.y, current.y);
        const right = Math.max(previous.x + previous.width, current.x + current.width);
        const bottom = Math.max(previous.y + previous.height, current.y + current.height);
        previous.x = left;
        previous.y = top;
        previous.width = right - left;
        previous.height = bottom - top;
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  function unifyVerticalColumnRects(rects: ViewportRect[]): ViewportRect[] {
    if (!readerContentIsVertical() || rects.length === 0) return rects;

    const groups: { left: number; right: number }[] = [];
    const groupForIndex = new Array<{ left: number; right: number }>(rects.length);
    rects.forEach((rect, index) => {
      const left = rect.x;
      const right = rect.x + rect.width;
      let group = groups.find((candidate) => rangesSubstantiallyOverlap(left, right, candidate.left, candidate.right));
      if (group) {
        group.left = Math.min(group.left, left);
        group.right = Math.max(group.right, right);
      } else {
        group = { left, right };
        groups.push(group);
      }
      groupForIndex[index] = group;
    });

    return rects.map((rect, index) => {
      const group = groupForIndex[index];
      return { x: group.left, y: rect.y, width: group.right - group.left, height: rect.height };
    });
  }

  function overlayRectsFromViewportRects(rects: ViewportRect[]): OverlayRect[] {
    if (!containerEl) return [];
    const viewportRect = containerEl.getBoundingClientRect();
    const scrollTop = logicalScrollPos();
    return rects
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.x - viewportRect.left,
        top: rect.y - viewportRect.top + scrollTop,
        width: rect.width,
        height: rect.height,
      }));
  }

  function lookupOverlayRectsForRanges(ranges: Range[]): OverlayRect[] {
    const rects = ranges.flatMap((range) => lookupRectsForRange(range));
    return overlayRectsFromViewportRects(unifyVerticalColumnRects(mergeLookupRects(rects)));
  }

  function applyLookupHighlightCount(characterCount: number, force = false) {
    if (activeLookupRanges.length === 0 || (!force && characterCount === lastAppliedLookupHighlightCount)) return;
    if (characterCount <= 0) {
      lookupHighlightRects = [];
      lookupHighlightText = "";
      clearLookupHighlight(READER_LOOKUP_HIGHLIGHT);
      lastAppliedLookupHighlightCount = 0;
      return;
    }

    const ranges = lookupCharacterRanges(characterCount);
    if (ranges.length === 0) {
      lookupHighlightRects = [];
      lookupHighlightText = "";
      clearLookupHighlight(READER_LOOKUP_HIGHLIGHT);
      lastAppliedLookupHighlightCount = characterCount;
      return;
    }

    clearLookupHighlight(READER_LOOKUP_HIGHLIGHT);
    lookupHighlightRects = lookupOverlayRectsForRanges(ranges);
    lookupHighlightText = ranges.map((range) => range.toString()).join("").replace(/\s+/g, " ").trim();
    ranges.forEach((range) => range.detach());
    window.getSelection()?.removeAllRanges();
    lastAppliedLookupHighlightCount = characterCount;
  }

  function chapterOffsetForRange(range: Range): number | undefined {
    if (!contentEl) return undefined;
    return readerCharOffsetForRange(range, contentEl);
  }

  function clearSasayakiHighlight() {
    clearLookupHighlight(READER_SASAYAKI_HIGHLIGHT);
    sasayakiHighlightRects = [];
    sasayakiHighlightText = "";
  }

  function overlayRectsForRanges(ranges: Range[]): OverlayRect[] {
    if (!containerEl) return [];

    const viewportRect = containerEl.getBoundingClientRect();
    const scrollTop = logicalScrollPos();
    return ranges.flatMap((range) => Array.from(range.getClientRects()))
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - viewportRect.left,
        top: rect.top - viewportRect.top + scrollTop,
        width: rect.width,
        height: rect.height,
      }));
  }

  function sasayakiOverlayRectsFor(range: Range): { left: number; top: number; width: number; height: number }[] {
    return overlayRectsForRanges([range]);
  }

  function selectTextFromPoint(
    x: number,
    y: number,
    resolvedHit?: { node: Text; offset: number; rect: ReaderSelectionRect },
  ): ReaderSelection | null {
    if (!contentEl) return null;
    const target = document.elementFromPoint(x, y);
    if (target instanceof Element && contentEl.contains(target) && target.closest("a[data-epub-href], img, image, svg")) {
      clearSelection();
      return null;
    }

    const hit = resolvedHit ?? characterAtPoint(x, y);
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
    const maxLookupText = lookupScanLength();

    while (node && text.length < maxLookupText) {
      const content = node.textContent ?? "";
      const start = offset;

      while (offset < content.length && text.length < maxLookupText) {
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

      if (offset < content.length || text.length >= maxLookupText) break;

      const next = walker.nextNode();
      node = next?.nodeType === Node.TEXT_NODE ? next as Text : null;
      offset = 0;
    }

    text = selectionText(text);
    if (!text || ranges.length === 0) {
      return null;
    }

    const visibleRange = document.createRange();
    visibleRange.setStart(ranges[0].startContainer, ranges[0].startOffset);
    const lastRange = ranges[ranges.length - 1];
    visibleRange.setEnd(lastRange.endContainer, lastRange.endOffset);
    detachActiveLookupRange();
    activeLookupRanges = ranges.map((range) => range.cloneRange());
    lastAppliedLookupHighlightCount = 0;
    lookupHighlightRects = [];
    lookupHighlightText = "";
    clearLookupHighlight(READER_LOOKUP_HIGHLIGHT);
    window.getSelection()?.removeAllRanges();

    const rect = unionRects(ranges.flatMap((range) => Array.from(range.getClientRects())));
    ranges.forEach((range) => range.detach());
    visibleRange.detach();
    if (!rect) {
      return null;
    }

    const anchorRect = hit.rect;
    const context = sentenceContext(root, visibleRange);
    const chapterOffset = chapterOffsetForRange(visibleRange);
    const selection = { text, ...context, ...(chapterOffset !== undefined ? { chapterOffset } : {}), rect, anchorRect, chapterIndex };
    hasActiveSelection = true;
    onSelectionChange(selection);
    return selection;
  }

  function clearSelection() {
    cancelShiftHoverFrame();
    window.getSelection()?.removeAllRanges();
    detachActiveLookupRange();
    hasActiveSelection = false;
    onSelectionChange(null);
  }

  function cancelShiftHoverFrame() {
    if (shiftHoverFrame === null) return;
    window.cancelAnimationFrame(shiftHoverFrame);
    shiftHoverFrame = null;
  }

  function resetShiftHoverState() {
    cancelShiftHoverFrame();
    lastShiftHoverHit = null;
  }

  function leaveReaderPointerState() {
    lastPointer = null;
    pointerDownPoint = null;
    resetShiftHoverState();
  }

  function scheduleShiftHoverLookup() {
    if (!shiftKeyPressed || !lastPointer || shiftHoverFrame !== null) return;
    shiftHoverFrame = window.requestAnimationFrame(() => {
      shiftHoverFrame = null;
      if (!shiftKeyPressed || !lastPointer) return;
      const { x, y } = lastPointer;
      const hit = characterAtPoint(x, y);
      if (!hit) {
        lastShiftHoverHit = null;
        return;
      }
      if (lastShiftHoverHit?.node === hit.node && lastShiftHoverHit.offset === hit.offset) return;
      lastShiftHoverHit = { node: hit.node, offset: hit.offset };
      selectTextFromPoint(x, y, hit);
    });
  }

  function shouldScheduleShiftHoverLookup(pointer: { x: number; y: number } | null): boolean {
    return shiftKeyPressed && pointer !== null;
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

  function applySasayakiCue() {
    clearSasayakiHighlight();
    if (!layoutReady || !contentEl || !sasayakiCue || sasayakiCue.chapterIndex !== chapterIndex) return;

    const range = readerRangeForOffsets(contentEl, sasayakiCue.start, sasayakiCue.length);
    if (!range) return;
    const rects = sasayakiOverlayRectsFor(range);
    sasayakiHighlightRects = rects;
    sasayakiHighlightText = range.toString().replace(/\s+/g, " ").trim();

    if (sasayakiReveal && containerEl) {
      if (rects.length > 0) {
        const logicalTop = Math.min(...rects.map((rect) => rect.top));
        goPage(Math.floor(Math.max(0, logicalTop + PAGE_EPSILON) / pageSize()));
      }
    }
    range.detach();
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
    applySasayakiCue();
    applyLookupHighlightCount(lookupHighlightCount, true);
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
      const wasShiftPressed = shiftKeyPressed;
      shiftKeyPressed = true;
      if (!wasShiftPressed && lastPointer && shouldScheduleShiftHoverLookup(lastPointer)) {
        scheduleShiftHoverLookup();
      }
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
    if (!href) {
      if (e.button !== 0 || movedAfterPointerDown(e.clientX, e.clientY)) return;
      selectTextFromPoint(e.clientX, e.clientY);
      return;
    }

    e.preventDefault();
    onNavigateHref(href);
  }

  function handlePointerDown(e: PointerEvent) {
    pointerDownPoint = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (e.target instanceof Element && e.target.closest("a[data-epub-href]")) return;
    if (hasActiveSelection) clearSelection();
  }

  function movedAfterPointerDown(x: number, y: number): boolean {
    if (!pointerDownPoint) return false;
    const dx = x - pointerDownPoint.x;
    const dy = y - pointerDownPoint.y;
    return dx * dx + dy * dy > 16;
  }

  function handlePointerMove(e: PointerEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    shiftKeyPressed = e.shiftKey;
    if (shouldScheduleShiftHoverLookup(lastPointer)) {
      scheduleShiftHoverLookup();
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
      clearSasayakiHighlight();
      lastPointer = null;
      resetShiftHoverState();
      layoutRun += 1;
    }
  });

  $effect(() => {
    lookupHighlightSignal;
    applyLookupHighlightCount(lookupHighlightCount);
  });

  $effect(() => {
    sasayakiCueSignal;
    sasayakiCue;
    sasayakiReveal;
    layoutReady;
    untrack(() => applySasayakiCue());
  });

  $effect(() => () => clearSasayakiHighlight());

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

    viewport.addEventListener("click", handleContentClick);
    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerleave", leaveReaderPointerState);
    return () => {
      viewport.removeEventListener("click", handleContentClick);
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
    {#if lookupHighlightRects.length > 0}
      <div class="lookup-highlight-layer" data-highlight-text={lookupHighlightText} aria-hidden="true">
        {#each lookupHighlightRects as rect}
          <span
            class="lookup-highlight-rect"
            style={`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`}
          ></span>
        {/each}
      </div>
    {/if}
    {#if sasayakiHighlightRects.length > 0}
      <div class="sasayaki-highlight-layer" data-highlight-text={sasayakiHighlightText} aria-hidden="true">
        {#each sasayakiHighlightRects as rect}
          <span
            class="sasayaki-highlight-rect"
            style={`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`}
          ></span>
        {/each}
      </div>
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

  .lookup-highlight-layer,
  .sasayaki-highlight-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: visible;
    pointer-events: none;
  }

  .lookup-highlight-rect,
  .sasayaki-highlight-rect {
    position: absolute;
    display: block;
    border-radius: 2px;
    pointer-events: none;
  }

  .lookup-highlight-rect {
    background: var(--lookup-highlight-color, rgba(160, 160, 160, 0.32));
  }

  .sasayaki-highlight-rect {
    background: var(--sasayaki-highlight-background, rgba(135, 206, 235, 0.4));
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
