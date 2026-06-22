import type { ReaderSelection, ReaderSelectionRect } from "./types";

const POPUP_SCAN_BOUNDARIES = new Set(Array.from("。、！？…‥「」『』（）()【】〈〉《》〔〕｛｝{}［］[]・：；:;，,.─"));

const LOOKUP_MAX_LENGTH = 16;

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export interface PopupTextHit {
  node: Text;
  offset: number;
  rect: ReaderSelectionRect;
  root: HTMLElement;
}

export interface PopupTextSelection {
  selection: ReaderSelection;
  range: Range;
  hit: PopupTextHit;
}

export function popupTextHitAtPoint(x: number, y: number): PopupTextHit | null {
  const target = document.elementFromPoint(x, y);
  if (!(target instanceof Element)) return null;

  const glossaryRoot = target.closest<HTMLElement>(".lookup-glossary-content");
  if (!glossaryRoot) return null;
  if (target.closest([
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "[role='button']",
    ".lookup-head",
    ".lookup-tag",
    ".lookup-anki",
    ".lookup-action",
    ".lookup-glossary-dict",
    "summary",
  ].join(","))) return null;

  const hit = characterAtPoint(x, y, glossaryRoot);
  return hit ? { ...hit, root: glossaryRoot } : null;
}

export function selectPopupTextFromHit(
  hit: PopupTextHit,
  x: number,
  y: number,
  chapterIndex: number,
): PopupTextSelection | null {
  const built = buildSelection(hit, hit.root, x, y, chapterIndex);
  if (!built) return null;

  return {
    selection: {
      text: built.text,
      rect: built.rect,
      anchorRect: built.anchorRect,
      chapterIndex,
    },
    range: built.range,
    hit,
  };
}

export function selectPopupTextFromPoint(x: number, y: number, chapterIndex: number): PopupTextSelection | null {
  const hit = popupTextHitAtPoint(x, y);
  return hit ? selectPopupTextFromHit(hit, x, y, chapterIndex) : null;
}

export function popupSelectionPrefixRange(range: Range, characterCount: number): Range | null {
  if (characterCount <= 0 || !range.startContainer.parentElement?.isConnected) return null;
  const commonRoot = range.commonAncestorContainer;
  const walkerRoot = commonRoot.nodeType === Node.TEXT_NODE ? commonRoot.parentElement : commonRoot;
  if (!(walkerRoot instanceof HTMLElement)) return null;

  const walker = textWalker(walkerRoot);
  if (range.startContainer.nodeType === Node.TEXT_NODE) walker.currentNode = range.startContainer;
  let node: Text | null = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer as Text
    : walker.nextNode() as Text | null;
  let remaining = characterCount;

  while (node) {
    if (!range.intersectsNode(node)) {
      node = walker.nextNode() as Text | null;
      continue;
    }
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    let offset = start;
    while (offset < end) {
      offset += codeUnitLengthAt(node.data, offset);
      remaining -= 1;
      if (remaining === 0) {
        const prefix = document.createRange();
        prefix.setStart(range.startContainer, range.startOffset);
        prefix.setEnd(node, offset);
        return prefix;
      }
    }
    if (node === range.endContainer) break;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

function characterAtPoint(x: number, y: number, root: HTMLElement): Omit<PopupTextHit, "root"> | null {
  const range = caretRangeAtPoint(x, y, root);
  if (!range) return fallbackCharacterAtPoint(x, y, root);

  const candidates = [
    { node: range.startContainer, offset: range.startOffset },
    { node: range.startContainer, offset: range.startOffset - 1 },
    { node: range.startContainer, offset: range.startOffset + 1 },
  ];

  for (const candidate of candidates) {
    if (candidate.node.nodeType !== Node.TEXT_NODE) continue;
    const node = candidate.node as Text;
    if (!nodeInsideRoot(node, root)) continue;
    const offset = clampOffset(candidate.offset, node);
    if (offset === null) continue;
    const charRange = document.createRange();
    charRange.setStart(node, offset);
    charRange.setEnd(node, offset + codeUnitLengthAt(node.data, offset));
    const hit = rangeContainsPoint(charRange, x, y);
    const anchorDomRect = Array.from(charRange.getClientRects()).find((rect) => rectContainsPoint(rect, x, y))
      ?? charRange.getBoundingClientRect();
    charRange.detach();
    if (hit && !isScanBoundary(node.data[offset]) && anchorDomRect.width > 0 && anchorDomRect.height > 0) {
      return { node, offset, rect: rectSnapshotFromDomRect(anchorDomRect) };
    }
  }

  return fallbackCharacterAtPoint(x, y, root);
}

function caretRangeAtPoint(x: number, y: number, root: HTMLElement): Range | null {
  const doc = document as CaretDocument;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    if (nodeInsideRoot(range.startContainer, root)) return range;
    range.detach();
  }

  const range = doc.caretRangeFromPoint?.(x, y) ?? null;
  if (range && nodeInsideRoot(range.startContainer, root)) return range;
  range?.detach();
  return null;
}

function fallbackCharacterAtPoint(x: number, y: number, root: HTMLElement): Omit<PopupTextHit, "root"> | null {
  const walker = textWalker(root);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    for (let offset = 0; offset < node.data.length; offset += codeUnitLengthAt(node.data, offset)) {
      if (isScanBoundary(node.data[offset])) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + codeUnitLengthAt(node.data, offset));
      const hit = rangeContainsPoint(range, x, y);
      const anchorDomRect = Array.from(range.getClientRects()).find((rect) => rectContainsPoint(rect, x, y))
        ?? range.getBoundingClientRect();
      range.detach();
      if (hit && anchorDomRect.width > 0 && anchorDomRect.height > 0) {
        return { node, offset, rect: rectSnapshotFromDomRect(anchorDomRect) };
      }
    }
  }
  return null;
}

function buildSelection(hit: PopupTextHit, root: HTMLElement, x: number, y: number, chapterIndex: number) {
  const ranges: Range[] = [];
  const walker = textWalker(root);
  walker.currentNode = hit.node;

  let node: Text | null = hit.node;
  let offset = hit.offset;
  let text = "";

  while (node && text.length < LOOKUP_MAX_LENGTH) {
    const start = offset;
    while (offset < node.data.length && text.length < LOOKUP_MAX_LENGTH) {
      const char = String.fromCodePoint(node.data.codePointAt(offset) ?? 0);
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

    if (offset < node.data.length || text.length >= LOOKUP_MAX_LENGTH) break;
    node = walker.nextNode() as Text | null;
    offset = 0;
  }

  const normalized = normalizeSelectionText(text);
  if (!normalized || ranges.length === 0) {
    ranges.forEach((range) => range.detach());
    return null;
  }

  const rect = selectionRect(ranges, x, y);
  if (!rect) {
    ranges.forEach((range) => range.detach());
    return null;
  }

  const visibleRange = document.createRange();
  visibleRange.setStart(ranges[0].startContainer, ranges[0].startOffset);
  const last = ranges[ranges.length - 1];
  visibleRange.setEnd(last.endContainer, last.endOffset);
  ranges.forEach((range) => range.detach());

  return { text: normalized, rect, anchorRect: hit.rect, range: visibleRange, chapterIndex };
}

function selectionRect(ranges: Range[], x: number, y: number): ReaderSelectionRect | null {
  const rects = ranges.flatMap((range) => Array.from(range.getClientRects()));
  const hovered = rects.find((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  const rect = hovered ?? rects[0];
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rangeContainsPoint(range: Range, x: number, y: number): boolean {
  return Array.from(range.getClientRects()).some((rect) => (
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  ));
}

function rectContainsPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function rectSnapshotFromDomRect(rect: DOMRect): ReaderSelectionRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function textWalker(root: HTMLElement): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("rt, rp, script, style, a[href], button, input, select, textarea")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
}

function nodeInsideRoot(node: Node, root: HTMLElement): boolean {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return element instanceof Node && root.contains(element);
}

function codeUnitLengthAt(text: string, offset: number): number {
  return (text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
}

function clampOffset(offset: number, node: Text): number | null {
  if (node.data.length === 0) return null;
  if (offset < 0) return null;
  if (offset >= node.data.length) return node.data.length - 1;
  return offset;
}

function isScanBoundary(char: string): boolean {
  return POPUP_SCAN_BOUNDARIES.has(char) || /^\s$/.test(char);
}

function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
