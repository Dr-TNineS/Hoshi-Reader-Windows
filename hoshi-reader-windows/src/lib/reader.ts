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
