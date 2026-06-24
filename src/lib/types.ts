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
  sentence?: string;
  sentenceOffset?: number;
  rect: ReaderSelectionRect;
  anchorRect?: ReaderSelectionRect;
  chapterIndex: number;
}

export interface GlossaryEntry {
  dict: string;
  text: string;
  definitionTags?: string;
  termTags?: string;
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

export interface LookupAnkiPayload {
  selectedText: string;
  sentence: string;
  sentenceOffset?: number;
  resultIndex: number;
  expression: string;
  reading: string;
  glossary: GlossaryEntry[];
  dictionary: string;
  matched: string;
  deinflected: string;
  rules: string;
  frequencies: FrequencyEntry[];
  pitches: PitchEntry[];
  media: LookupAnkiMediaReference[];
  audioFilename: string | null;
  coverFilename: string | null;
  sourceBook: LookupAnkiSourceBook;
  sourceChapter: LookupAnkiSourceChapter;
}

export interface LookupAnkiMediaReference {
  dictionary: string;
  path: string;
  alt: string;
  title: string;
  filename: string;
}

export interface AnkiDictionaryMediaRef {
  dictionary: string;
  path: string;
  filename: string;
}

export interface AnkiStoredMedia {
  dictionary: string;
  path: string;
  filename: string;
}

export interface AnkiStoreMediaResult {
  stored: AnkiStoredMedia[];
  warnings: string[];
}

export interface AnkiStoreBookCoverResult {
  filename: string | null;
  warnings: string[];
}

export interface LookupAnkiSourceBook {
  title: string | null;
  bookId?: string;
  path?: string;
  sourcePath?: string;
  libraryPath?: string;
}

export interface LookupAnkiSourceChapter {
  chapterIndex: number;
  chapterNumber: number;
  totalChapters: number;
  idref: string | null;
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

export interface AnkiRemoteAudioRequest {
  sourceName: string;
  urlTemplate: string;
  expression: string;
  reading: string;
  timeoutMs: number;
}

export interface AnkiStoreRemoteAudioResult {
  filename: string | null;
  warnings: string[];
}

export interface WordAudioResolveRequest {
  expression: string;
  reading: string;
  localAudioEnabled: boolean;
  sources: AnkiAudioSource[];
  timeoutMs: number;
}

export interface WordAudioPlaybackResult {
  cachePath: string | null;
  mimeType: string | null;
  sourceName: string | null;
  warnings: string[];
}

export interface LocalAudioSourceStatus {
  name: string;
  order: number;
}

export interface LocalAudioStatus {
  imported: boolean;
  sizeBytes: number | null;
  sources: LocalAudioSourceStatus[];
}

export interface SasayakiStatus {
  configured: boolean;
  audioStorage: "external" | "copied" | null;
  audioFileName: string | null;
  audioExtension: string | null;
  audioSizeBytes: number | null;
  audioAvailable: boolean;
  subtitleFileName: string | null;
  subtitleSizeBytes: number | null;
  cueCount: number;
  matchedCount: number;
  unmatchedCount: number;
  correctedCount: number;
  matchRate: number;
  lastPosition: number;
  delay: number;
  rate: number;
}

export interface SasayakiCueItem {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  matched: boolean;
  corrected: boolean;
  chapterIndex: number | null;
  start: number | null;
  length: number | null;
}

export interface SasayakiCuePage {
  total: number;
  offset: number;
  items: SasayakiCueItem[];
}

export interface LocalAudioStoreRequest {
  expression: string;
  reading: string;
}

export interface LocalAudioStoreResult {
  filename: string | null;
  warnings: string[];
}

export interface DictImportFailure {
  path: string;
  error: string;
}

export interface DictImportBatchSummary {
  imported: DictImportSummary[];
  failures: DictImportFailure[];
  skippedCount: number;
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
  importId: string;
  title: string;
  kind: string;
  role: DictionaryRole;
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

export type DictionaryRole = "term" | "frequency" | "pitch";

export interface AnkiDeck {
  name: string;
}

export interface AnkiNoteType {
  name: string;
  fields: string[];
}

export interface AnkiSettings {
  version: number;
  endpoint: string;
  selectedDeck: string | null;
  selectedNoteType: string | null;
  decks: AnkiDeck[];
  noteTypes: AnkiNoteType[];
  fieldMappings: AnkiFieldMapping[];
  audioEnabled: boolean;
  localAudioEnabled: boolean;
  audioSources: AnkiAudioSource[];
  audioDownloadTimeoutMs: number;
  forceSyncAfterAdd: boolean;
  tags: string;
  allowDuplicates: boolean;
  checkDuplicatesAcrossAllModels: boolean;
  duplicateScope: AnkiDuplicateScope;
  compactGlossaries: boolean;
  audioAutoplay: boolean;
  audioPlaybackMode: AudioPlaybackMode;
  lastFetchedAt: number | null;
}

export type AnkiDuplicateScope = "collection" | "deck" | "deckRoot";
export type AudioPlaybackMode = "interrupt" | "duck" | "mix";

export interface AnkiConnectionStatus {
  ok: boolean;
  message: string;
  version: number | null;
}

export interface AnkiFieldMapping {
  field: string;
  template: string;
}

export interface AnkiAudioSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface AnkiFieldPreview {
  field: string;
  template: string;
  value: string;
}

export interface AnkiNoteRequest {
  endpoint: string;
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  forceSyncAfterAdd: boolean;
  allowDuplicates: boolean;
  checkDuplicatesAcrossAllModels: boolean;
  duplicateScope: AnkiDuplicateScope;
}

export interface AnkiNoteCheckResult {
  canAdd: boolean;
  duplicate: boolean;
  message: string;
}

export interface AnkiAddNoteResult {
  status: "added" | "duplicate" | "error";
  noteId: number | null;
  message: string;
  warnings: string[];
}
