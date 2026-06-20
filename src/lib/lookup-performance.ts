export type LookupPerformanceStage =
  | "status-start"
  | "status-ready"
  | "invoke-start"
  | "invoke-end"
  | "state-committed"
  | "first-paint"
  | "styles-ready"
  | "first-media-ready";

export interface LookupPerformanceRecord {
  requestId: number;
  popupId: string;
  source: string;
  text: string;
  startedAt: number;
  stages: Partial<Record<LookupPerformanceStage, number>>;
  details: Record<string, string | number | boolean>;
}

declare global {
  interface Window {
    __HSW_LOOKUP_PERFORMANCE__?: LookupPerformanceRecord[];
  }
}

const activeRecords = new Map<number, LookupPerformanceRecord>();
const MAX_RETAINED_RECORDS = 100;

function enabled(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined";
}

export function beginLookupPerformance(
  requestId: number,
  popupId: string,
  text: string,
  source: string,
) {
  if (!enabled()) return;
  const record: LookupPerformanceRecord = {
    requestId,
    popupId,
    source,
    text,
    startedAt: performance.now(),
    stages: {},
    details: {},
  };
  activeRecords.set(requestId, record);
  const retained = window.__HSW_LOOKUP_PERFORMANCE__ ?? [];
  retained.push(record);
  if (retained.length > MAX_RETAINED_RECORDS) {
    const removed = retained.splice(0, retained.length - MAX_RETAINED_RECORDS);
    for (const oldRecord of removed) activeRecords.delete(oldRecord.requestId);
  }
  window.__HSW_LOOKUP_PERFORMANCE__ = retained;
  performance.mark(`hsw.lookup.${requestId}.start`);
}

export function markLookupPerformance(
  requestId: number,
  stage: LookupPerformanceStage,
  details: Record<string, string | number | boolean> = {},
) {
  if (!enabled()) return;
  const record = activeRecords.get(requestId);
  if (!record || record.stages[stage] !== undefined) return;
  const elapsedMs = performance.now() - record.startedAt;
  record.stages[stage] = elapsedMs;
  Object.assign(record.details, details);
  performance.mark(`hsw.lookup.${requestId}.${stage}`);
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  console.info(
    `[lookup-perf] request_id=${requestId} popup_id=${record.popupId} source=${record.source} `
      + `stage=${stage} elapsed_ms=${elapsedMs.toFixed(2)}${detailText ? ` ${detailText}` : ""}`,
  );
}

export function discardLookupPerformance(requestId: number) {
  activeRecords.delete(requestId);
}
