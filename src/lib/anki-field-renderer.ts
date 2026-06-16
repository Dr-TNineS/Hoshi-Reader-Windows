import { frequencyLabel, pitchLabel } from "./lookup-popup";
import type { AnkiFieldMapping, AnkiFieldPreview, AnkiSettings, LookupAnkiPayload } from "./types";

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
    default:
      return "";
  }
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
  return "";
}
