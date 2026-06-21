import { frequencyLabel, pitchLabel, renderGlossaryContent } from "./lookup-popup";
import type { AnkiDictionaryMediaRef, AnkiFieldMapping, AnkiFieldPreview, AnkiNoteRequest, AnkiNoteType, AnkiSettings, AnkiStoredMedia, GlossaryEntry, LookupAnkiMediaReference, LookupAnkiPayload } from "./types";

const TOKEN_PATTERN = /\{([^{}]+)\}/g;
const SINGLE_GLOSSARY_PREFIX = "single-glossary-";
const CORE_HANDLEBAR_OPTIONS = [
  "-",
  "{expression}",
  "{reading}",
  "{popup-selection-text}",
  "{glossary-first}",
  "{glossary}",
  "{sentence}",
  "{document-title}",
  "{frequencies}",
  "{pitch-accent-positions}",
  "{dictionary-media}",
  "{audio}",
];
const KNOWN_NOTE_TYPE_TEMPLATES: Record<string, Record<string, string>> = {
  Lapis: {
    Expression: "{expression}",
    ExpressionFurigana: "{furigana-plain}",
    ExpressionReading: "{reading}",
    ExpressionAudio: "{audio}",
    SelectionText: "{popup-selection-text}",
    MainDefinition: "{glossary-first}",
    Sentence: "{sentence}",
    SentenceAudio: "{sasayaki-audio}",
    Picture: "{book-cover}",
    Glossary: "{glossary}",
    PitchPosition: "{pitch-accent-positions}",
    PitchCategories: "{pitch-accent-categories}",
    Frequency: "{frequencies}",
    FreqSort: "{frequency-harmonic-rank}",
    MiscInfo: "{document-title}",
    IsWordAndSentenceCard: "x",
  },
  Kiku: {
    Expression: "{expression}",
    ExpressionFurigana: "{furigana-plain}",
    ExpressionReading: "{reading}",
    ExpressionAudio: "{audio}",
    SelectionText: "{popup-selection-text}",
    MainDefinition: "{glossary-first}",
    Sentence: "{sentence}",
    SentenceAudio: "{sasayaki-audio}",
    Picture: "{book-cover}",
    Glossary: "{glossary}",
    PitchPosition: "{pitch-accent-positions}",
    PitchCategories: "{pitch-accent-categories}",
    Frequency: "{frequencies}",
    FreqSort: "{frequency-harmonic-rank}",
    MiscInfo: "{document-title}",
    IsWordAndSentenceCard: "x",
  },
  Senren: {
    word: "{expression}",
    reading: "{reading}",
    sentence: "{sentence}",
    sentenceCard: "x",
    selectionText: "{popup-selection-text}",
    definition: "{glossary-first}",
    wordAudio: "{audio}",
    sentenceAudio: "{sasayaki-audio}",
    picture: "{book-cover}",
    glossary: "{glossary}",
    pitchPositions: "{pitch-accent-positions}",
    pitchCategories: "{pitch-accent-categories}",
    frequencies: "{frequencies}",
    freqSort: "{frequency-harmonic-rank}",
    miscInfo: "{document-title}",
  },
};

export function isAnkiPreviewConfigured(settings: AnkiSettings | null | undefined): boolean {
  const noteType = selectedNoteType(settings);
  return Boolean(settings?.selectedDeck && noteType && noteType.fields.length > 0);
}

export function selectedNoteType(settings: AnkiSettings | null | undefined) {
  if (!settings?.selectedNoteType) return null;
  return settings.noteTypes.find((noteType) => noteType.name === settings.selectedNoteType) ?? null;
}

export function effectiveTemplateForField(
  field: string,
  settings: AnkiSettings | null | undefined,
): string {
  const explicit = settings?.fieldMappings.find((mapping) => mapping.field === field)?.template;
  if (explicit !== undefined) return explicit;
  const known = knownTemplateForField(selectedNoteType(settings), field);
  if (known !== null) return known;
  return defaultTemplateForField(field);
}

export function upsertFieldTemplate(
  mappings: AnkiFieldMapping[],
  field: string,
  template: string,
): AnkiFieldMapping[] {
  const next = mappings.filter((mapping) => mapping.field !== field);
  next.push({ field, template });
  return next;
}

export function pruneFieldMappings(settings: AnkiSettings): AnkiFieldMapping[] {
  const fields = new Set(selectedNoteType(settings)?.fields ?? []);
  return settings.fieldMappings.filter((mapping) => fields.has(mapping.field));
}

export function applyKnownNoteTypeDefaultsIfUnmapped(settings: AnkiSettings): AnkiFieldMapping[] {
  const noteType = selectedNoteType(settings);
  const pruned = pruneFieldMappings(settings);
  if (!noteType || pruned.length > 0) return pruned;
  return knownDefaultMappings(noteType);
}

export function renderAnkiFieldPreview(
  payload: LookupAnkiPayload,
  settings: AnkiSettings | null | undefined,
): AnkiFieldPreview[] {
  const noteType = selectedNoteType(settings);
  if (!noteType) return [];
  return noteType.fields.map((field) => {
    const template = effectiveTemplateForField(field, settings);
    return {
      field,
      template,
      value: renderTemplate(template, payload, settings?.compactGlossaries ?? false),
    };
  });
}

export function buildAnkiNoteRequest(
  payload: LookupAnkiPayload,
  settings: AnkiSettings | null | undefined,
): AnkiNoteRequest | null {
  const noteType = selectedNoteType(settings);
  if (!settings?.selectedDeck || !noteType) return null;
  const fields: Record<string, string> = {};
  for (const preview of renderAnkiFieldPreview(payload, settings)) {
    fields[preview.field] = preview.value;
  }
  return {
    endpoint: settings.endpoint,
    deckName: settings.selectedDeck,
    modelName: noteType.name,
    fields,
    tags: settings.tags.trim().split(/\s+/).filter(Boolean),
    forceSyncAfterAdd: settings.forceSyncAfterAdd,
    allowDuplicates: settings.allowDuplicates,
    checkDuplicatesAcrossAllModels: settings.checkDuplicatesAcrossAllModels,
    duplicateScope: settings.duplicateScope,
  };
}

export function renderTemplate(template: string, payload: LookupAnkiPayload, compactGlossaries = false): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) => tokenValue(token, payload, compactGlossaries));
}

function tokenValue(token: string, payload: LookupAnkiPayload, compactGlossaries: boolean): string {
  const normalized = token.toLowerCase();
  if (normalized.startsWith(SINGLE_GLOSSARY_PREFIX)) {
    return glossaryTextForDictionary(token.slice(SINGLE_GLOSSARY_PREFIX.length), payload, compactGlossaries);
  }
  switch (normalized) {
    case "expression":
      return payload.expression;
    case "reading":
      return payload.reading;
    case "popup-selection-text":
      return payload.selectedText;
    case "glossary-first":
      return payload.glossary[0] ? renderAnkiGlossaryEntries([payload.glossary[0]], compactGlossaries) : "";
    case "glossary":
      return renderAnkiGlossaryEntries(payload.glossary, compactGlossaries);
    case "sentence":
      return payload.sentence;
    case "document-title":
      return payload.sourceBook.title ?? "";
    case "frequencies":
      return frequencyLabel({ frequencies: payload.frequencies } as Parameters<typeof frequencyLabel>[0]);
    case "pitch-accent-positions":
      return pitchLabel({ pitches: payload.pitches } as Parameters<typeof pitchLabel>[0]);
    case "dictionary-media":
      return renderDictionaryMedia(payload.media);
    case "audio":
      return payload.audioFilename ? `[sound:${payload.audioFilename}]` : "";
    case "book-cover":
      return payload.coverFilename ? `<img src="${escapeHtml(payload.coverFilename)}">` : "";
    default:
      return "";
  }
}

export function ankiHandlebarOptions(dictionaryNames: string[]): string[] {
  const seen = new Set<string>();
  const dictionaryOptions = dictionaryNames
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => `{${SINGLE_GLOSSARY_PREFIX}${name}}`);
  return [...CORE_HANDLEBAR_OPTIONS, ...dictionaryOptions];
}

export function extractDictionaryMediaReferences(glossary: GlossaryEntry[]): LookupAnkiMediaReference[] {
  const refs: LookupAnkiMediaReference[] = [];
  const seen = new Set<string>();
  for (const entry of glossary) {
    for (const image of extractMediaRecords(entry.text)) {
      const path = image.path.trim();
      if (!path) continue;
      const dictionary = entry.dict.trim();
      const key = `${dictionary}\u0000${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        dictionary,
        path,
        alt: image.alt || image.title || path,
        title: image.title || image.alt || path,
        filename: stableDictionaryMediaFilename(dictionary, path),
      });
    }
  }
  return refs;
}

export function ankiDictionaryMediaRefs(media: LookupAnkiMediaReference[]): AnkiDictionaryMediaRef[] {
  return media.map((item) => ({
    dictionary: item.dictionary,
    path: item.path,
    filename: item.filename,
  }));
}

export function payloadWithStoredDictionaryMedia(
  payload: LookupAnkiPayload,
  stored: AnkiStoredMedia[],
): LookupAnkiPayload {
  if (stored.length === 0) return { ...payload, media: [] };
  const filenames = new Map(stored.map((item) => [mediaKey(item.dictionary, item.path), item.filename]));
  return {
    ...payload,
    media: payload.media
      .filter((item) => filenames.has(mediaKey(item.dictionary, item.path)))
      .map((item) => ({ ...item, filename: filenames.get(mediaKey(item.dictionary, item.path)) ?? item.filename })),
  };
}

export function stableDictionaryMediaFilename(dictionary: string, path: string): string {
  const extension = mediaExtension(path);
  return `hsw_${fnv1a(`${dictionary}\u0000${path}`)}${extension}`;
}

function knownDefaultMappings(noteType: AnkiNoteType): AnkiFieldMapping[] {
  const templates = KNOWN_NOTE_TYPE_TEMPLATES[noteType.name];
  if (!templates) return [];
  return noteType.fields
    .filter((field) => templates[field] !== undefined)
    .map((field) => ({ field, template: templates[field] }));
}

function knownTemplateForField(noteType: AnkiNoteType | null, field: string): string | null {
  if (!noteType) return null;
  const templates = KNOWN_NOTE_TYPE_TEMPLATES[noteType.name];
  if (!templates) return null;
  return templates[field] ?? "";
}

function defaultTemplateForField(field: string): string {
  const normalized = field.toLowerCase().replace(/[\s_-]+/g, "");
  if (["expression", "word", "term", "vocab", "vocabulary", "front"].includes(normalized)) return "{expression}";
  if (["reading", "kana", "furigana"].includes(normalized)) return "{reading}";
  if (["meaning", "definition", "definitions", "glossary", "back"].includes(normalized)) return "{glossary}";
  if (["sentence", "context", "example", "example_sentence"].includes(normalized)) return "{sentence}";
  if (["source", "book", "document", "documenttitle"].includes(normalized)) return "{document-title}";
  if (["frequency", "frequencies", "freq"].includes(normalized)) return "{frequencies}";
  if (["pitch", "pitchaccent", "pitchaccentpositions"].includes(normalized)) return "{pitch-accent-positions}";
  if (["media", "image", "images", "picture", "pictures", "dictionarymedia"].includes(normalized)) return "{dictionary-media}";
  if (["audio", "sound", "wordaudio", "expressionaudio"].includes(normalized)) return "{audio}";
  return "";
}

function glossaryTextForDictionary(dictionary: string, payload: LookupAnkiPayload, compactGlossaries: boolean): string {
  const exact = payload.glossary.filter((entry) => entry.dict === dictionary);
  if (exact.length > 0) return renderAnkiGlossaryEntries(exact, compactGlossaries);

  const normalized = normalizeDictionaryName(dictionary);
  return renderAnkiGlossaryEntries(payload.glossary.filter((entry) => normalizeDictionaryName(entry.dict) === normalized), compactGlossaries);
}

export function payloadWithStoredRemoteAudio(
  payload: LookupAnkiPayload,
  filename: string | null,
): LookupAnkiPayload {
  return { ...payload, audioFilename: filename };
}

export function payloadWithStoredBookCover(
  payload: LookupAnkiPayload,
  filename: string | null,
): LookupAnkiPayload {
  return { ...payload, coverFilename: filename };
}

const COMPACT_GLOSSARY_STYLE = "<style>.yomitan-glossary ol,.yomitan-glossary ul{margin:.2em 0;padding-left:1.25em}.yomitan-glossary li{margin:.1em 0}.yomitan-glossary p{margin:.15em 0}</style>";

function renderAnkiGlossaryEntries(entries: GlossaryEntry[], compactGlossaries = false): string {
  const items = entries.map((entry, index) => renderAnkiGlossaryEntry(entry, index)).filter(Boolean).join("");
  if (!items) return "";
  const style = compactGlossaries ? COMPACT_GLOSSARY_STYLE : "";
  return `${style}<div style="text-align: left;" class="yomitan-glossary"><ol>${items}</ol></div>`;
}

function renderAnkiGlossaryEntry(entry: GlossaryEntry, index: number): string {
  const content = renderGlossaryContent(entry.text, entry.dict);
  const dictionary = entry.dict || "Dictionary";
  const tags = splitTags(entry.definitionTags).filter((tag) => !/^\d+$/.test(tag)).join(", ");
  const label = tags
    ? `(${index + 1}, ${tags}, ${dictionary})`
    : `(${index + 1}, ${dictionary})`;
  return `<li data-dictionary="${escapeHtml(dictionary)}"><i>${escapeHtml(label)}</i> <span>${content}</span></li>`;
}

function normalizeDictionaryName(dictionary: string): string {
  return dictionary.trim().replace(/\s*\[[^\]]+]\s*$/, "");
}

function splitTags(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(/[\s,;|]+/).map((tag) => tag.trim()).filter(Boolean))];
}

function renderDictionaryMedia(media: LookupAnkiMediaReference[]): string {
  return media.map((item) => (
    `<img src="${escapeHtml(item.filename)}" alt="${escapeHtml(item.alt)}">`
  )).join("\n");
}

function mediaKey(dictionary: string, path: string): string {
  return `${dictionary}\u0000${path}`;
}

function extractMediaRecords(text: string): Array<{ path: string; alt: string; title: string }> {
  const parsed = parseStructuredContent(text);
  if (parsed === null) return [];
  const records: Array<{ path: string; alt: string; title: string }> = [];
  visitStructuredContent(parsed, (record) => {
    const tag = typeof record.tag === "string" ? record.tag.toLowerCase() : "";
    if (tag !== "img" && tag !== "image") return;
    const path = typeof record.path === "string"
      ? record.path
      : typeof record.src === "string"
        ? record.src
        : "";
    if (!path) return;
    const title = typeof record.title === "string" ? record.title : path;
    const alt = typeof record.alt === "string" ? record.alt : title;
    records.push({ path, alt, title });
  });
  return records;
}

function parseStructuredContent(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function visitStructuredContent(value: unknown, visitor: (record: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) visitStructuredContent(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visitor(record);
  if ("content" in record) visitStructuredContent(record.content, visitor);
  if ("text" in record) visitStructuredContent(record.text, visitor);
}

function mediaExtension(path: string): string {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  if (!match) return "";
  const ext = match[1];
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "heic"].includes(ext)) return `.${ext}`;
  return "";
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
