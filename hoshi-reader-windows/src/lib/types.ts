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

export interface GlossaryEntry {
  dict: string;
  text: string;
}

export interface DictResult {
  expression: string;
  reading: string;
  glossary: GlossaryEntry[];
  matched: string;
  deinflected: string;
  rules: string;
  dictionary: string;
  frequencies: FrequencyEntry[];
  pitches: PitchEntry[];
}

export interface FrequencyEntry {
  dictionary: string;
  items: FrequencyItem[];
}

export interface FrequencyItem {
  value: number;
  displayValue: string;
}

export interface PitchEntry {
  dictionary: string;
  positions: number[];
  transcriptions: string[];
}

export interface DictImportSummary {
  dictId: string;
  title: string;
  dictionaryPath: string;
  termCount: number;
  metaCount: number;
  freqCount: number;
  pitchCount: number;
  mediaCount: number;
  ready: boolean;
  reused: boolean;
}

export type DictionaryStatusKind = "ready" | "noDictionaries" | "engineUnavailable" | "error";

export interface DictionaryStatus {
  status: DictionaryStatusKind;
  message: string;
  loadedCount: number;
  importedCount: number;
}

export interface DictionaryManifestEntry {
  dictId: string;
  title: string;
  kind: string;
  enabled: boolean;
  order: number;
  internalPath: string;
  termCount: number;
  metaCount: number;
  freqCount: number;
  pitchCount: number;
  mediaCount: number;
  lastImported: number;
}
