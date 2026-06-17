import { frequencyLabel, pitchLabel } from "./lookup-popup";
import type { AnkiDictionaryMediaRef, AnkiFieldMapping, AnkiFieldPreview, AnkiNoteRequest, AnkiSettings, AnkiStoredMedia, GlossaryEntry, LookupAnkiMediaReference, LookupAnkiPayload } from "./types";

const TOKEN_PATTERN = /\{([a-z0-9-]+)\}/gi;

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
      value: renderTemplate(template, payload),
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
    tags: ["hoshi-reader"],
  };
}

export function renderTemplate(template: string, payload: LookupAnkiPayload): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) => tokenValue(token.toLowerCase(), payload));
}

function tokenValue(token: string, payload: LookupAnkiPayload): string {
  switch (token) {
    case "expression":
      return payload.expression;
    case "reading":
      return payload.reading;
    case "popup-selection-text":
      return payload.selectedText;
    case "glossary-first":
      return payload.glossary[0]?.text ?? "";
    case "glossary":
      return payload.glossary.map((entry) => entry.text).filter(Boolean).join("\n\n");
    case "sentence":
      return payload.selectedText;
    case "document-title":
      return payload.sourceBook.title ?? "";
    case "frequencies":
      return frequencyLabel({ frequencies: payload.frequencies } as Parameters<typeof frequencyLabel>[0]);
    case "pitch-accent-positions":
      return pitchLabel({ pitches: payload.pitches } as Parameters<typeof pitchLabel>[0]);
    case "dictionary-media":
      return renderDictionaryMedia(payload.media);
    default:
      return "";
  }
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
  return "";
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
