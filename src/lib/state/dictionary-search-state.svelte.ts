import type { LookupPopupItem } from "../LookupPopupLayer.svelte";
import type { LookupState } from "../lookup-popup";
import type { DictResult, ReaderSelection } from "../types";

export interface DictionarySearchHistoryEntry {
  query: string;
  results: DictResult[];
  scrollTop: number;
}

export function createDictionarySearchState() {
  let query = $state("");
  let lastQuery = $state("");
  let rootSelection = $state<ReaderSelection | null>(null);
  let rootState = $state<LookupState>("idle");
  let rootError = $state("");
  let rootResults = $state<DictResult[]>([]);
  let rootRequestId = $state(0);
  let rootClearSelectionSignal = $state(0);
  let rootRestoreScrollTop = $state(0);
  let rootRestoreScrollSignal = $state(0);
  let rootHistoryBack = $state<DictionarySearchHistoryEntry[]>([]);
  let rootHistoryForward = $state<DictionarySearchHistoryEntry[]>([]);
  let childPopups = $state<LookupPopupItem[]>([]);
  let requestSerial = $state(0);
  let focusSignal = $state(0);

  function nextRequestId(): number {
    requestSerial += 1;
    return requestSerial;
  }

  function invalidateRequests() {
    requestSerial += 1;
  }

  function rootTextSelection(text: string): ReaderSelection {
    return {
      text,
      sentence: text,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      chapterIndex: 0,
    };
  }

  function clearForBlankSubmit() {
    invalidateRequests();
    lastQuery = "";
    rootSelection = null;
    rootState = "idle";
    rootError = "";
    rootResults = [];
    rootRequestId = 0;
    rootClearSelectionSignal += 1;
    rootRestoreScrollTop = 0;
    rootRestoreScrollSignal += 1;
    rootHistoryBack = [];
    rootHistoryForward = [];
    childPopups = [];
  }

  function beginRootSearch(text: string, requestId: number) {
    lastQuery = text;
    rootSelection = rootTextSelection(text);
    rootState = "loading";
    rootError = "";
    rootResults = [];
    rootRequestId = requestId;
    rootClearSelectionSignal += 1;
    rootRestoreScrollTop = 0;
    rootRestoreScrollSignal += 1;
    rootHistoryBack = [];
    rootHistoryForward = [];
    childPopups = [];
  }

  function commitRootLookup(state: LookupState, results: DictResult[], error: string) {
    rootState = state;
    rootResults = results;
    rootError = error;
  }

  function pushRootRedirect(text: string, requestId: number, currentScrollTop: number) {
    if (rootSelection) {
      rootHistoryBack = [...rootHistoryBack, { query: lastQuery, results: rootResults, scrollTop: currentScrollTop }];
    }
    lastQuery = text;
    query = text;
    rootSelection = rootTextSelection(text);
    rootState = "loading";
    rootError = "";
    rootResults = [];
    rootRequestId = requestId;
    rootHistoryForward = [];
    rootClearSelectionSignal += 1;
    rootRestoreScrollTop = 0;
    rootRestoreScrollSignal += 1;
    childPopups = [];
  }

  function restoreRootHistory(direction: "back" | "forward", currentScrollTop: number): DictionarySearchHistoryEntry | null {
    const from = direction === "back" ? rootHistoryBack : rootHistoryForward;
    if (from.length === 0) return null;
    const target = from[from.length - 1];
    const current = { query: lastQuery, results: rootResults, scrollTop: currentScrollTop };
    if (direction === "back") {
      rootHistoryBack = rootHistoryBack.slice(0, -1);
      rootHistoryForward = [...rootHistoryForward, current];
    } else {
      rootHistoryForward = rootHistoryForward.slice(0, -1);
      rootHistoryBack = [...rootHistoryBack, current];
    }
    lastQuery = target.query;
    query = target.query;
    rootSelection = rootTextSelection(target.query);
    rootState = target.results.length > 0 ? "ready" : "empty";
    rootError = "";
    rootResults = target.results;
    rootClearSelectionSignal += 1;
    rootRestoreScrollTop = target.scrollTop;
    rootRestoreScrollSignal += 1;
    childPopups = [];
    return target;
  }

  function requestFocus() {
    focusSignal += 1;
  }

  return {
    get query() { return query; },
    set query(value: string) { query = value; },
    get lastQuery() { return lastQuery; },
    get rootSelection() { return rootSelection; },
    get rootState() { return rootState; },
    get rootError() { return rootError; },
    get rootResults() { return rootResults; },
    get rootRequestId() { return rootRequestId; },
    get rootClearSelectionSignal() { return rootClearSelectionSignal; },
    get rootRestoreScrollTop() { return rootRestoreScrollTop; },
    get rootRestoreScrollSignal() { return rootRestoreScrollSignal; },
    get rootHistoryBack() { return rootHistoryBack; },
    get rootHistoryForward() { return rootHistoryForward; },
    get childPopups() { return childPopups; },
    set childPopups(value: LookupPopupItem[]) { childPopups = value; },
    get requestSerial() { return requestSerial; },
    get focusSignal() { return focusSignal; },
    nextRequestId,
    invalidateRequests,
    clearForBlankSubmit,
    beginRootSearch,
    commitRootLookup,
    pushRootRedirect,
    restoreRootHistory,
    requestFocus,
    rootTextSelection,
  };
}

export type DictionarySearchState = ReturnType<typeof createDictionarySearchState>;
