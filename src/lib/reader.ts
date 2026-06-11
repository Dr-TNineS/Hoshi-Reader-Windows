// Reader core - ported from Hoshi Reader Mac reader.js

const CJK_REGEX = /[0-9A-Za-z○▷〆〃々ヿ一-鿿豈-﫿︰-﹏\p{Radical}\p{Unified_Ideograph}]+/gimu;

export function isVertical(container: HTMLElement): boolean {
  return getComputedStyle(container).writingMode === "vertical-rl";
}

export function isFurigana(node: Node): boolean {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
  return !!el?.closest("rt, rp");
}

export function countChars(text: string): number {
  return Array.from(normalizeText(text)).length;
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

export function normalizeText(text: string): string {
  return text.replace(new RegExp(CJK_REGEX.source.replace(/^\[/, "[^"), "gimu"), "");
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
