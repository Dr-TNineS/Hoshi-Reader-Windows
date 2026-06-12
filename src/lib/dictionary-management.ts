import type { DictionaryManifestEntry, DictionaryStatus } from "./types";

export function importedLabel(timestamp: number): string {
  if (timestamp <= 0) return "Unknown import time";
  return new Date(timestamp * 1000).toLocaleString();
}

export function dictionaryCountsLabel(dictionary: DictionaryManifestEntry): string {
  const parts = [
    dictionary.termCount > 0 ? `${dictionary.termCount} terms` : "",
    dictionary.freqCount > 0 ? `${dictionary.freqCount} freq` : "",
    dictionary.pitchCount > 0 ? `${dictionary.pitchCount} pitch` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "No lookup data";
}

export function dictionaryStatusLabel(status: DictionaryStatus | null): string {
  if (!status) return "";
  if (status.status === "ready") {
    return `${status.loadedCount}/${status.importedCount} enabled dictionaries loaded.`;
  }
  return status.message;
}
