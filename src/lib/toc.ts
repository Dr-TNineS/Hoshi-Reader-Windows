import { normalizeHref } from "./epub-assets";
import type { EpubMeta, TocNode } from "./types";

export type TocEntry = {
  label: string;
  href: string | null;
  level: number;
  chapterIndex: number | null;
};

export function findChapterIndex(bookMeta: EpubMeta, href: string | null): number | null {
  if (!href) return null;
  const target = normalizeHref(href);
  const manifestById = new Map(bookMeta.manifest.map((item) => [item.id, normalizeHref(item.href)]));
  const spineHrefs = bookMeta.spine.map((item) => manifestById.get(item.idref) ?? "");
  const exact = spineHrefs.findIndex((spineHref) => spineHref === target);
  if (exact >= 0) return exact;
  const suffix = spineHrefs.findIndex(
    (spineHref) => spineHref.endsWith(`/${target}`) || target.endsWith(`/${spineHref}`)
  );
  return suffix >= 0 ? suffix : null;
}

export function flattenToc(nodes: TocNode[], bookMeta: EpubMeta, level = 0): TocEntry[] {
  return nodes.flatMap((node) => [
    {
      label: node.label,
      href: node.href,
      level,
      chapterIndex: findChapterIndex(bookMeta, node.href),
    },
    ...flattenToc(node.children, bookMeta, level + 1),
  ]);
}
