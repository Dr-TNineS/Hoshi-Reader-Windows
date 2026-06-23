import {
  formatLookupMatch,
  frequencyGroups,
  glossaryGroups,
  pitchGroups,
  renderGlossaryContent,
  ruleTags,
  type LookupFrequencyGroup,
  type LookupPitchGroup,
  type LookupPopupRenderOptions,
} from "./lookup-popup";
import type { DictResult, GlossaryEntry } from "./types";

export interface LookupPopupGlossaryEntry extends GlossaryEntry {
  definitionTagList: string[];
  html: string;
}

export interface LookupPopupGlossaryGroup {
  dictionary: string;
  termTags: string[];
  entries: LookupPopupGlossaryEntry[];
}

export interface LookupPopupResultViewModel {
  result: DictResult;
  resultIndex: number;
  key: string;
  match: string;
  rules: string[];
  frequencies: LookupFrequencyGroup[];
  pitches: LookupPitchGroup[];
  pitchMoras: string[];
  glossaryGroups: LookupPopupGlossaryGroup[];
}

export function createLookupPopupViewModels(results: DictResult[], options: LookupPopupRenderOptions = {}): LookupPopupResultViewModel[] {
  return results.map((result, resultIndex) => ({
    result,
    resultIndex,
    key: `${resultIndex}:${result.expression}:${result.reading}`,
    match: formatLookupMatch(result),
    rules: ruleTags(result),
    frequencies: frequencyGroups(result, options),
    pitches: pitchGroups(result, options),
    pitchMoras: Array.from(result.reading.trim()).slice(0, 18),
    glossaryGroups: glossaryGroups(result).map((group) => ({
      dictionary: group.dictionary,
      termTags: group.termTags,
      entries: group.entries.map((entry) => ({
        ...entry,
        html: renderGlossaryContent(entry.text, group.dictionary),
      })),
    })),
  }));
}

export function popupResultDictionaries(viewModels: LookupPopupResultViewModel[]): string[] {
  const dictionaries = new Set<string>();
  for (const viewModel of viewModels) {
    for (const group of viewModel.glossaryGroups) {
      if (group.dictionary) dictionaries.add(group.dictionary);
    }
  }
  return [...dictionaries];
}
