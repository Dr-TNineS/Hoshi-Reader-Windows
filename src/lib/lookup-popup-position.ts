import type { ReaderSelection } from "./types";

export interface LookupPopupSize {
  width: number;
  height: number;
}

export interface LookupPopupViewport {
  width: number;
  bottom: number;
}

export function clampPopupValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lookupPopupStyle(
  selection: ReaderSelection,
  size: LookupPopupSize,
  viewport: LookupPopupViewport,
): string {
  const anchor = selection.anchorRect ?? selection.rect;
  const margin = 12;
  const gap = 10;
  const topMargin = 44;
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(topMargin, viewport.bottom - size.height);
  const leftSpace = anchor.x - margin - gap;
  const rightSpace = viewport.width - anchor.x - anchor.width - margin - gap;
  const canFitLeft = leftSpace >= size.width;
  const canFitRight = rightSpace >= size.width;
  const verticalAnchor = selection.rect.height > selection.rect.width * 1.4 || anchor.height > anchor.width * 1.4;
  let left: number;

  if (verticalAnchor) {
    if (canFitRight) {
      left = anchor.x + anchor.width + gap;
    } else if (canFitLeft) {
      left = anchor.x - size.width - gap;
    } else {
      left = rightSpace >= leftSpace ? anchor.x + anchor.width + gap : anchor.x - size.width - gap;
    }
    const top = clampPopupValue(anchor.y, topMargin, maxTop);
    return `left:${clampPopupValue(left, margin, maxLeft)}px;top:${top}px`;
  }

  if (canFitLeft || canFitRight) {
    const placeRight = canFitRight && (!canFitLeft || rightSpace >= leftSpace);
    left = placeRight ? anchor.x + anchor.width + gap : anchor.x - size.width - gap;
    const top = clampPopupValue(anchor.y, topMargin, maxTop);
    return `left:${clampPopupValue(left, margin, maxLeft)}px;top:${top}px`;
  }

  if (Math.max(leftSpace, rightSpace) >= size.width * 0.6) {
    left = rightSpace >= leftSpace ? anchor.x + anchor.width + gap : anchor.x - size.width - gap;
    const top = clampPopupValue(anchor.y, topMargin, maxTop);
    return `left:${clampPopupValue(left, margin, maxLeft)}px;top:${top}px`;
  }

  left = clampPopupValue(anchor.x + anchor.width / 2 - size.width / 2, margin, maxLeft);
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - size.height - gap;
  const topCandidate = below <= maxTop ? below : above;
  const top = clampPopupValue(topCandidate, topMargin, maxTop);

  return `left:${left}px;top:${top}px`;
}
