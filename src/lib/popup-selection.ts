import type { ReaderSelection, ReaderSelectionRect } from "./types";

const POPUP_SCAN_BOUNDARIES = new Set([
  " ", "\t", "\n", "\r", "　", "。", "、", "！", "？", "…", "‥", "「", "」", "『", "』",
  "（", "）", "(", ")", "【", "】", "〈", "〉", "《", "》", "〔", "〕", "｛", "｝", "{", "}",
  "［", "］", "[", "]", "・", "：", "；", ":", ";", "，", ",", ".", "─", "\"", "'", "“",
  "”", "‘", "’", "«", "»", "‹", "›",
]);

const LOOKUP_MAX_LENGTH = 20;

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

interface TextHit {
  node: Text;
  offset: number;
  rect: ReaderSelectionRect;
}

export function selectPopupTextFromPoint(x: number, y: number, chapterIndex: number): ReaderSelection | null {
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
  if (!hit) return null;

  const selection = buildSelection(hit, glossaryRoot, x, y, chapterIndex);
  if (!selection) return null;

  const visibleSelection = window.getSelection();
  visibleSelection?.removeAllRanges();
  visibleSelection?.addRange(selection.range);
  selection.range.detach();

  return {
    text: selection.text,
    rect: selection.rect,
    anchorRect: selection.anchorRect,
    chapterIndex,
  };
}

function characterAtPoint(x: number, y: number, root: HTMLElement): TextHit | null {
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

function fallbackCharacterAtPoint(x: number, y: number, root: HTMLElement): TextHit | null {
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

function buildSelection(hit: TextHit, root: HTMLElement, x: number, y: number, chapterIndex: number) {
  const ranges: Range[] = [];
  const walker = textWalker(root);
  walker.currentNode = hit.node;

  let node: Text | null = hit.node;
  let offset = expandTokenStart(node.data, hit.offset);
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

function expandTokenStart(text: string, offset: number): number {
  let current = offset;
  while (current > 0) {
    const previous = previousCodePoint(text, current);
    if (!previous || isScanBoundary(previous.char)) break;
    current = previous.offset;
  }
  return current;
}

function previousCodePoint(text: string, offset: number): { char: string; offset: number } | null {
  if (offset <= 0) return null;
  const first = text.charCodeAt(offset - 1);
  const start = first >= 0xdc00 && first <= 0xdfff && offset > 1 ? offset - 2 : offset - 1;
  return { char: String.fromCodePoint(text.codePointAt(start) ?? 0), offset: start };
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
