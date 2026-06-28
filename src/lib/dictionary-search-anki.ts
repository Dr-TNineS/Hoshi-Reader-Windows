import { extractDictionaryMediaReferences } from "./anki-field-renderer";
import { resultDictionaryLabel } from "./lookup-popup";
import type { DictResult, LookupAnkiPayload } from "./types";

export function buildDictionarySearchAnkiPayload(query: string, result: DictResult, resultIndex: number): LookupAnkiPayload {
  const selectedText = query.trim() || result.matched || result.expression;
  return {
    selectedText,
    sentence: selectedText,
    sentenceOffset: undefined,
    resultIndex,
    expression: result.expression,
    reading: result.reading,
    glossary: result.glossary,
    dictionary: resultDictionaryLabel(result),
    matched: result.matched,
    deinflected: result.deinflected,
    rules: result.rules,
    frequencies: result.frequencies,
    pitches: result.pitches,
    media: extractDictionaryMediaReferences(result.glossary),
    audioFilename: null,
    sasayakiCueId: null,
    sasayakiAudioFilename: null,
    coverFilename: null,
    sourceBook: {
      title: "Dictionary Search",
    },
    sourceChapter: {
      chapterIndex: 0,
      chapterNumber: 0,
      totalChapters: 0,
      idref: "dictionary-search",
    },
  };
}
