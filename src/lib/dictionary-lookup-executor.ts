import type { DictionarySettings } from "./dictionary-settings";
import type { LookupState } from "./lookup-popup";
import type { LookupResultCache } from "./lookup-result-cache";
import type { DictResult, DictionaryStatus } from "./types";

export interface DictionaryLookupExecutorResult {
  state: LookupState;
  results: DictResult[];
  error: string;
}

export interface DictionaryLookupExecutorOptions {
  text: string;
  requestId: number;
  settings: Pick<DictionarySettings, "maxResults" | "scanLength">;
  isCurrent: () => boolean;
  lookupStatus: () => Promise<DictionaryStatus>;
  lookup: (text: string, requestId: number, settings: Pick<DictionarySettings, "maxResults" | "scanLength">) => Promise<DictResult[]>;
  cache?: LookupResultCache<DictResult>;
  onStatusStart?: () => void;
  onStatusReady?: (status: DictionaryStatus) => void;
  onLookupStart?: (cacheHit: boolean) => void;
  onLookupEnd?: (results: DictResult[], cacheHit: boolean) => void;
  onStatusInvalidated?: () => void;
  fallbackStatus?: () => Promise<DictionaryStatus>;
}

export function lookupStatusMessage(status: DictionaryStatus): string {
  if (status.status === "noDictionaries") return status.message || "No dictionaries are imported yet.";
  if (status.status === "engineUnavailable") {
    return status.message || "Dictionary engine unavailable. Check CMake/C++ tooling and hoshidicts linkage.";
  }
  return status.message || "Dictionary status could not be read.";
}

export function lookupStateForStatus(status: DictionaryStatus): LookupState {
  if (status.status === "noDictionaries") return "noDictionaries";
  if (status.status === "engineUnavailable") return "engineUnavailable";
  if (status.status === "error") return "error";
  return "ready";
}

export async function runDictionaryLookup(options: DictionaryLookupExecutorOptions): Promise<DictionaryLookupExecutorResult | null> {
  const text = options.text.trim();
  if (!text) return { state: "idle", results: [], error: "" };

  try {
    options.onStatusStart?.();
    const status = await options.lookupStatus();
    options.onStatusReady?.(status);
    if (!options.isCurrent()) return null;
    if (status.status !== "ready") {
      return {
        state: lookupStateForStatus(status),
        error: lookupStatusMessage(status),
        results: [],
      };
    }

    const lookupRequest = options.cache
      ? options.cache.get(text, (cachedText) => options.lookup(cachedText, options.requestId, options.settings))
      : { promise: options.lookup(text, options.requestId, options.settings), cacheHit: false };
    options.onLookupStart?.(lookupRequest.cacheHit);
    const results = await lookupRequest.promise;
    options.onLookupEnd?.(results, lookupRequest.cacheHit);
    if (!options.isCurrent()) return null;
    return {
      state: results.length > 0 ? "ready" : "empty",
      error: "",
      results,
    };
  } catch (error) {
    if (!options.isCurrent()) return null;
    options.onStatusInvalidated?.();
    if (options.fallbackStatus) {
      try {
        const status = await options.fallbackStatus();
        if (!options.isCurrent()) return null;
        if (status.status !== "ready") {
          return {
            state: lookupStateForStatus(status),
            error: lookupStatusMessage(status),
            results: [],
          };
        }
      } catch {
        options.onStatusInvalidated?.();
      }
    }
    return {
      state: "error",
      error: String(error),
      results: [],
    };
  }
}
