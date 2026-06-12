import type { DictResult } from "./types";

export type LookupState = "idle" | "loading" | "ready" | "empty" | "error" | "noDictionaries" | "engineUnavailable";

export function formatLookupMatch(result: DictResult): string {
  if (result.matched && result.deinflected && result.matched !== result.deinflected) {
    return `${result.matched} -> ${result.deinflected}`;
  }
  return result.matched || result.deinflected || "";
}

export function frequencyLabel(result: DictResult): string {
  const entry = result.frequencies.find((frequency) => frequency.items.length > 0);
  if (!entry) return "";

  const values = entry.items
    .slice(0, 3)
    .map((item) => item.displayValue || String(item.value))
    .filter(Boolean);
  if (values.length === 0) return "";
  return `${entry.dictionary}: ${values.join(", ")}`;
}

export function pitchLabel(result: DictResult): string {
  const entry = result.pitches.find((pitch) => pitch.positions.length > 0 || pitch.transcriptions.length > 0);
  if (!entry) return "";

  const details = [
    entry.positions.length > 0 ? `pitch ${entry.positions.join(", ")}` : "",
    entry.transcriptions.slice(0, 2).join(", "),
  ].filter(Boolean);
  if (details.length === 0) return "";
  return `${entry.dictionary}: ${details.join(" | ")}`;
}

export function resultDictionaryLabel(result: DictResult): string {
  return result.dictionary || result.glossary[0]?.dict || result.frequencies[0]?.dictionary || result.pitches[0]?.dictionary || "";
}
