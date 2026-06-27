// Reader core - ported from Hoshi Reader Mac reader.js, with HSA-aligned reader text counting.

function inRange(value: number, start: number, end: number): boolean {
  return value >= start && value <= end;
}

export function isReaderMatchableCodePoint(codePoint: number): boolean {
  return inRange(codePoint, 0x30, 0x39) ||
    inRange(codePoint, 0x41, 0x5a) ||
    inRange(codePoint, 0x61, 0x7a) ||
    codePoint === 0x25cb ||
    codePoint === 0x25ef ||
    inRange(codePoint, 0x3005, 0x3007) ||
    codePoint === 0x303b ||
    inRange(codePoint, 0x3041, 0x3096) ||
    inRange(codePoint, 0x309d, 0x309e) ||
    inRange(codePoint, 0x30a1, 0x30fa) ||
    codePoint === 0x30fc ||
    inRange(codePoint, 0xff10, 0xff19) ||
    inRange(codePoint, 0xff21, 0xff3a) ||
    inRange(codePoint, 0xff41, 0xff5a) ||
    inRange(codePoint, 0xff66, 0xff9d) ||
    inRange(codePoint, 0x2e80, 0x2fdf) ||
    inRange(codePoint, 0x3400, 0x4dbf) ||
    inRange(codePoint, 0x4e00, 0x9fff) ||
    inRange(codePoint, 0x20000, 0x2a6df) ||
    inRange(codePoint, 0x2a700, 0x2b73f) ||
    inRange(codePoint, 0x2b740, 0x2b81f) ||
    inRange(codePoint, 0x2b820, 0x2ceaf) ||
    inRange(codePoint, 0x2ceb0, 0x2ebef) ||
    inRange(codePoint, 0x30000, 0x3134f) ||
    inRange(codePoint, 0x31350, 0x323af);
}

export function isVertical(container: HTMLElement): boolean {
  return getComputedStyle(container).writingMode === "vertical-rl";
}

export function isFurigana(node: Node): boolean {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
  return !!el?.closest("rt, rp");
}

export function countChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && isReaderMatchableCodePoint(codePoint)) count += 1;
  }
  return count;
}

export function textEndOffsets(text: string): number[] {
  const offsets: number[] = [];
  let rawOffset = 0;
  for (const ch of text) {
    rawOffset += ch.length;
    if (countChars(ch) > 0) offsets.push(rawOffset);
  }
  return offsets;
}

export function rawOffsetForReaderChars(text: string, targetChars: number): number {
  if (targetChars <= 0) return 0;
  let rawOffset = 0;
  let chars = 0;
  for (const ch of text) {
    rawOffset += ch.length;
    if (countChars(ch) > 0) chars += 1;
    if (chars >= targetChars) return rawOffset;
  }
  return text.length;
}

export function rawStartOffsetForReaderChars(text: string, skippedChars: number): number {
  let rawOffset = 0;
  let chars = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && isReaderMatchableCodePoint(codePoint)) {
      if (chars >= skippedChars) return rawOffset;
      chars += 1;
    }
    rawOffset += ch.length;
  }
  return text.length;
}

export function normalizeText(text: string): string {
  let normalized = "";
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && isReaderMatchableCodePoint(codePoint)) normalized += ch;
  }
  return normalized;
}

export function createWalker(root: Node): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => isFurigana(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
}

export function getTotalChars(container: HTMLElement): number {
  const walker = createWalker(container);
  let total = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    total += countChars(node.textContent || "");
  }
  return total;
}

export function getCharOffset(node: Node, container: HTMLElement): number {
  const walker = createWalker(container);
  let offset = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) break;
    offset += countChars(n.textContent || "");
  }
  return offset;
}

export function readerCharOffsetForRange(range: Range, container: HTMLElement): number | undefined {
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return undefined;
  const textNode = range.startContainer as Text;
  if (!container.contains(textNode.parentElement)) return undefined;
  return getCharOffset(textNode, container) + countChars((textNode.textContent ?? "").slice(0, range.startOffset));
}

export function readerRangeForOffsets(
  container: HTMLElement,
  start: number,
  length: number,
): Range | null {
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0) return null;

  const targetEnd = start + length;
  const walker = createWalker(container);
  let seen = 0;
  let startPoint: { node: Text; offset: number } | null = null;
  let endPoint: { node: Text; offset: number } | null = null;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.textContent ?? "";
    const nodeChars = countChars(text);
    const nextSeen = seen + nodeChars;

    if (!startPoint && start < nextSeen) {
      startPoint = {
        node: textNode,
        offset: rawStartOffsetForReaderChars(text, start - seen),
      };
    }
    if (startPoint && targetEnd <= nextSeen) {
      endPoint = {
        node: textNode,
        offset: rawOffsetForReaderChars(text, targetEnd - seen),
      };
      break;
    }

    seen = nextSeen;
  }

  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}
