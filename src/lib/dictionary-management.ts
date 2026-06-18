import type { DictionaryManifestEntry, DictionaryRole, DictionaryStatus } from "./types";

export const dictionaryRoles: DictionaryRole[] = ["term", "frequency", "pitch"];

export const dictionaryRoleLabels: Record<DictionaryRole, string> = {
  term: "Term",
  frequency: "Frequency",
  pitch: "Pitch",
};

export function dictionaryRole(dictionary: DictionaryManifestEntry): DictionaryRole {
  if (dictionary.role === "frequency" || dictionary.role === "pitch") return dictionary.role;
  return "term";
}

export function importedLabel(timestamp: number): string {
  if (timestamp <= 0) return "Unknown import time";
  return new Date(timestamp * 1000).toLocaleString();
}

export function dictionaryCountsLabel(dictionary: DictionaryManifestEntry): string {
  if (dictionaryRole(dictionary) === "term") {
    return dictionary.termCount > 0 ? `${dictionary.termCount} terms` : "No term data";
  }
  if (dictionaryRole(dictionary) === "frequency") {
    return dictionary.freqCount > 0 ? `${dictionary.freqCount} freq` : "No frequency data";
  }
  return dictionary.pitchCount > 0 ? `${dictionary.pitchCount} pitch` : "No pitch data";
}

export function dictionaryStatusLabel(status: DictionaryStatus | null): string {
  if (!status) return "";
  if (status.status === "ready") {
    return `${status.loadedCount}/${status.importedCount} enabled dictionaries loaded.`;
  }
  return status.message;
}
