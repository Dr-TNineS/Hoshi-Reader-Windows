type HighlightConstructor = new (...ranges: Range[]) => Highlight;

interface HighlightRegistry {
  set(name: string, highlight: Highlight): void;
  delete(name: string): boolean;
  get(name: string): LookupHighlight | undefined;
}

interface LookupHighlight {
  forEach?(callback: (range: Range) => void): void;
  [Symbol.iterator]?(): IterableIterator<Range>;
}

declare global {
  interface Window {
    Highlight?: HighlightConstructor;
  }

}

export const READER_LOOKUP_HIGHLIGHT = "hsw-reader-lookup-selection";
export const POPUP_LOOKUP_HIGHLIGHT = "hsw-popup-lookup-selection";

export function setLookupHighlightRange(name: string, range: Range): void {
  setLookupHighlightRanges(name, [range]);
}

export function setLookupHighlightRanges(name: string, ranges: Range[]): void {
  clearLookupHighlight(name);
  const registry = lookupHighlightRegistry();
  const HighlightCtor = window.Highlight;
  if (!registry || !HighlightCtor || ranges.length === 0) return;

  ensureLookupHighlightStyles();
  registry.set(name, new HighlightCtor(...ranges.map((range) => range.cloneRange())));
  window.getSelection()?.removeAllRanges();
}

export function clearLookupHighlight(name: string): void {
  lookupHighlightRegistry()?.delete(name);
}

export function lookupHighlightText(name: string): string {
  const highlight = lookupHighlightRegistry()?.get(name);
  if (!highlight) return "";

  const parts: string[] = [];
  if (highlight.forEach) {
    highlight.forEach((range) => parts.push(range.toString()));
  } else if (highlight[Symbol.iterator]) {
    const iterator = highlight[Symbol.iterator];
    if (iterator) {
      for (const range of iterator.call(highlight)) parts.push(range.toString());
    }
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

function lookupHighlightRegistry(): HighlightRegistry | null {
  const registry = CSS.highlights as unknown as HighlightRegistry | undefined;
  return registry ?? null;
}

function ensureLookupHighlightStyles(): void {
  if (document.querySelector("style[data-hsw-lookup-highlight]")) return;

  const style = document.createElement("style");
  style.dataset.hswLookupHighlight = "true";
  style.textContent = `
::highlight(${READER_LOOKUP_HIGHLIGHT}) {
  background-color: rgba(160, 160, 160, 0.4);
  background-color: color-mix(in srgb, var(--reader-info, #999999) 42%, transparent);
  color: inherit;
}

::highlight(${POPUP_LOOKUP_HIGHLIGHT}) {
  background-color: rgba(160, 160, 160, 0.4);
  color: inherit;
}
`;
  document.head.appendChild(style);
}
