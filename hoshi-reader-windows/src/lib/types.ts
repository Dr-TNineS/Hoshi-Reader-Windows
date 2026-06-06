export interface EpubMeta {
  title: string | null;
  cover_href: string | null;
  manifest: ManifestItem[];
  spine: SpineItem[];
  toc: TocNode[];
  book_info: BookInfo;
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

export interface BookInfo {
  character_count: number;
  chapter_info: ChapterInfo[];
}

export interface ChapterInfo {
  spine_index: number;
  current_total: number;
  chapter_count: number;
}

export interface ReaderProgress {
  chapterIndex: number;
  chapterProgress: number;
  chapterReadChars: number;
  bookReadChars: number;
  totalBookChars: number;
  percent: number;
}

export interface ReaderSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReaderSelection {
  text: string;
  rect: ReaderSelectionRect;
  chapterIndex: number;
}

