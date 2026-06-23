export type DictionaryCollapseMode = "expandAll" | "collapseAll" | "custom";

export interface DictionarySettings {
  scanNonJapaneseText: boolean;
  maxResults: number;
  scanLength: number;
  lowRamDictionaryImport: boolean;
  collapseMode: DictionaryCollapseMode;
  expandFirstDictionary: boolean;
  collapsedDictionaries: string[];
  compactGlossaries: boolean;
  showExpressionTags: boolean;
  harmonicFrequency: boolean;
  deduplicatePitchAccents: boolean;
  compactPitchAccents: boolean;
}

export const DICTIONARY_MAX_RESULTS = { min: 1, max: 50, default: 16 };
export const DICTIONARY_SCAN_LENGTH = { min: 1, max: 64, default: 16 };

export const defaultDictionarySettings: DictionarySettings = {
  scanNonJapaneseText: true,
  maxResults: DICTIONARY_MAX_RESULTS.default,
  scanLength: DICTIONARY_SCAN_LENGTH.default,
  lowRamDictionaryImport: false,
  collapseMode: "expandAll",
  expandFirstDictionary: false,
  collapsedDictionaries: [],
  compactGlossaries: true,
  showExpressionTags: false,
  harmonicFrequency: false,
  deduplicatePitchAccents: false,
  compactPitchAccents: true,
};

const STORAGE_KEY = "hoshi_reader_dictionary_settings";

export function normalizeDictionarySettings(value: unknown): DictionarySettings {
  const record = value && typeof value === "object" ? value as Partial<DictionarySettings> : {};
  return {
    scanNonJapaneseText: booleanSetting(record.scanNonJapaneseText, defaultDictionarySettings.scanNonJapaneseText),
    maxResults: clampInteger(record.maxResults, DICTIONARY_MAX_RESULTS.default, DICTIONARY_MAX_RESULTS.min, DICTIONARY_MAX_RESULTS.max),
    scanLength: clampInteger(record.scanLength, DICTIONARY_SCAN_LENGTH.default, DICTIONARY_SCAN_LENGTH.min, DICTIONARY_SCAN_LENGTH.max),
    lowRamDictionaryImport: booleanSetting(record.lowRamDictionaryImport, defaultDictionarySettings.lowRamDictionaryImport),
    collapseMode: collapseModeSetting(record.collapseMode),
    expandFirstDictionary: booleanSetting(record.expandFirstDictionary, defaultDictionarySettings.expandFirstDictionary),
    collapsedDictionaries: stringList(record.collapsedDictionaries),
    compactGlossaries: booleanSetting(record.compactGlossaries, defaultDictionarySettings.compactGlossaries),
    showExpressionTags: booleanSetting(record.showExpressionTags, defaultDictionarySettings.showExpressionTags),
    harmonicFrequency: booleanSetting(record.harmonicFrequency, defaultDictionarySettings.harmonicFrequency),
    deduplicatePitchAccents: booleanSetting(record.deduplicatePitchAccents, defaultDictionarySettings.deduplicatePitchAccents),
    compactPitchAccents: booleanSetting(record.compactPitchAccents, defaultDictionarySettings.compactPitchAccents),
  };
}

export function loadDictionarySettings(): DictionarySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeDictionarySettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...defaultDictionarySettings };
  }
}

export function saveDictionarySettings(settings: DictionarySettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeDictionarySettings(settings)));
  } catch {
    // Ignore unavailable storage; runtime state still uses normalized settings.
  }
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function collapseModeSetting(value: unknown): DictionaryCollapseMode {
  return value === "collapseAll" || value === "custom" ? value : defaultDictionarySettings.collapseMode;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}
