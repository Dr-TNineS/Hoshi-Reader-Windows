import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DictionaryStyleResource {
  css: string;
  source: string;
}

const dictionaryStyleCache = new Map<string, Promise<DictionaryStyleResource>>();

export function clearDictionaryStyleCache() {
  dictionaryStyleCache.clear();
}

export function loadCachedDictionaryStyles(dictionary: string): Promise<DictionaryStyleResource> {
  const key = dictionary.trim();
  if (!key) return Promise.resolve({ css: "", source: dictionary });

  const cached = dictionaryStyleCache.get(key);
  if (cached) return cached;

  const request = invokeDictionaryStyles(key).catch((error) => {
    dictionaryStyleCache.delete(key);
    throw error;
  });
  dictionaryStyleCache.set(key, request);
  return request;
}

async function invokeDictionaryStyles(dictionary: string): Promise<DictionaryStyleResource> {
  if (!isTauri()) return { css: "", source: dictionary };
  return invoke<DictionaryStyleResource>("dictionary_styles", { dictionary });
}
