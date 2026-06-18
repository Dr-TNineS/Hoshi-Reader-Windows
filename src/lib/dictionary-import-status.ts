import type { DictImportBatchSummary, DictImportSummary } from "./types";

export function dictionaryImportSummaryLabel(imported: DictImportSummary): string {
  const reused = imported.reused ? "Reused" : "Imported";
  const ready = imported.ready ? "ready" : "not ready";
  return `${reused} ${imported.title} (${imported.termCount} terms, ${ready}).`;
}

export function dictionaryBatchStatusLabel(summary: DictImportBatchSummary): string {
  const importedCount = summary.imported.length;
  const failedCount = summary.failures.length;
  const skipped = summary.skippedCount > 0 ? ` Skipped ${summary.skippedCount} non-zip file${summary.skippedCount === 1 ? "" : "s"}.` : "";
  const failures = summary.failures
    .slice(0, 3)
    .map((failure) => `${failure.path}: ${failure.error}`)
    .join("\n");
  const moreFailures = failedCount > 3 ? `\n...and ${failedCount - 3} more failure${failedCount - 3 === 1 ? "" : "s"}.` : "";

  if (importedCount === 1 && failedCount === 0 && summary.skippedCount === 0) {
    return dictionaryImportSummaryLabel(summary.imported[0]);
  }

  const importedTitles = summary.imported
    .slice(0, 3)
    .map((imported) => imported.title)
    .join(", ");
  const importedDetail = importedTitles ? ` ${importedTitles}${importedCount > 3 ? `, and ${importedCount - 3} more` : ""}.` : "";
  const failureDetail = failures ? `\n${failures}${moreFailures}` : "";
  return `Imported ${importedCount} dictionar${importedCount === 1 ? "y" : "ies"}.${importedDetail} ${failedCount} failed.${skipped}${failureDetail}`;
}
