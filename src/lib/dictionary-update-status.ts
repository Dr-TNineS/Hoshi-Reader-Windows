import type { DictionaryUpdateSummary } from "./types";

export function dictionaryUpdateStatusLabel(summary: DictionaryUpdateSummary): string {
  const failedCount = summary.failures.length;
  const checked = summary.checkedCount;

  if (checked === 0) {
    return "No updatable dictionaries found.";
  }

  const failures = summary.failures
    .slice(0, 3)
    .map((failure) => `${failure.title}: ${failure.message}`)
    .join("\n");
  const moreFailures = failedCount > 3 ? `\n...and ${failedCount - 3} more failure${failedCount - 3 === 1 ? "" : "s"}.` : "";
  const renameDetail = summary.renamedDictionaries.length
    ? ` Renamed ${summary.renamedDictionaries
        .slice(0, 3)
        .map((rename) => `${rename.oldTitle} -> ${rename.newTitle}`)
        .join(", ")}.`
    : "";

  if (summary.updatedCount === 0 && failedCount === 0) {
    return `Checked ${checked} dictionar${checked === 1 ? "y" : "ies"}. No updates available.`;
  }

  const failureDetail = failures ? `\n${failures}${moreFailures}` : "";
  return `Updated ${summary.updatedCount} of ${checked} dictionar${checked === 1 ? "y" : "ies"}.${renameDetail} ${failedCount} failed.${failureDetail}`;
}
