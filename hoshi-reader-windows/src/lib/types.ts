export interface EpubMeta {
  title: string | null;
  cover_href: string | null;
  manifest: ManifestItem[];
  spine: SpineItem[];
  toc: TocNode[];
}

export interface ManifestItem {
  id: string;
  href: string;
  media_type: string;
  properties: string | null;
}

export interface SpineItem {
  idref: string;
  linear: boolean;
}

export interface TocNode {
  label: string;
  href: string | null;
  children: TocNode[];
}

