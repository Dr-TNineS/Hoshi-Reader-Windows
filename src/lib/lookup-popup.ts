import type { DictResult, FrequencyEntry, GlossaryEntry, PitchEntry } from "./types";

export type LookupState = "idle" | "loading" | "ready" | "empty" | "error" | "noDictionaries" | "engineUnavailable";

export function formatLookupMatch(result: DictResult): string {
  if (result.matched && result.deinflected && result.matched !== result.deinflected) {
    return `${result.matched} -> ${result.deinflected}`;
  }
  return result.matched || result.deinflected || "";
}

export function frequencyLabel(result: DictResult): string {
  const entry = frequencyGroups(result)[0];
  if (!entry) return "";

  return `${entry.dictionary}: ${entry.values.join(", ")}`;
}

export function pitchLabel(result: DictResult): string {
  const entry = pitchGroups(result)[0];
  if (!entry) return "";

  const details = [
    entry.positions.length > 0 ? `pitch ${entry.positions.join(", ")}` : "",
    entry.transcriptions.slice(0, 2).join(", "),
  ].filter(Boolean);
  if (details.length === 0) return "";
  return `${entry.dictionary}: ${details.join(" | ")}`;
}

export interface LookupFrequencyGroup {
  dictionary: string;
  values: string[];
}

export interface LookupPitchGroup {
  dictionary: string;
  positions: number[];
  transcriptions: string[];
}

export interface LookupPopupRenderOptions {
  harmonicFrequency?: boolean;
  deduplicatePitchAccents?: boolean;
}

export function frequencyGroups(result: Pick<DictResult, "frequencies">, options: LookupPopupRenderOptions = {}): LookupFrequencyGroup[] {
  const groups = result.frequencies
    .map((entry: FrequencyEntry) => ({
      dictionary: entry.dictionary || "Frequency",
      values: entry.items
        .slice(0, 3)
        .map((item) => item.displayValue || String(item.value))
        .filter(Boolean),
    }))
    .filter((entry) => entry.values.length > 0);

  if (!options.harmonicFrequency) return groups;

  const numericValues = result.frequencies
    .flatMap((entry) => entry.items.map((item) => item.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numericValues.length < 2) return groups;

  const harmonic = Math.round(numericValues.length / numericValues.reduce((sum, value) => sum + (1 / value), 0));
  return [...groups, { dictionary: "Harmonic", values: [String(harmonic)] }];
}

export function pitchGroups(result: Pick<DictResult, "pitches">, options: LookupPopupRenderOptions = {}): LookupPitchGroup[] {
  const seenPositions = new Set<number>();
  return result.pitches
    .map((entry: PitchEntry) => {
      const positions = [...new Set(entry.positions.filter((position) => Number.isFinite(position)))]
        .filter((position) => {
          if (!options.deduplicatePitchAccents) return true;
          if (seenPositions.has(position)) return false;
          seenPositions.add(position);
          return true;
        });
      return {
        dictionary: entry.dictionary || "Pitch",
        positions,
        transcriptions: [...new Set(entry.transcriptions.map((item) => item.trim()).filter(Boolean))],
      };
    })
    .filter((entry) => entry.positions.length > 0 || entry.transcriptions.length > 0);
}

export function resultDictionaryLabel(result: DictResult): string {
  return result.dictionary || result.glossary[0]?.dict || result.frequencies[0]?.dictionary || result.pitches[0]?.dictionary || "";
}

export interface GlossaryGroup {
  dictionary: string;
  termTags: string[];
  entries: Array<GlossaryEntry & { definitionTagList: string[] }>;
}

export function ruleTags(result: DictResult): string[] {
  return splitTags(result.rules);
}

export function splitTags(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(/[\s,;|]+/).map((tag) => tag.trim()).filter(Boolean))];
}

export function glossaryGroups(result: DictResult): GlossaryGroup[] {
  const groups = new Map<string, GlossaryGroup>();
  for (const entry of result.glossary) {
    const dictionary = entry.dict || result.dictionary || "Dictionary";
    let group = groups.get(dictionary);
    if (!group) {
      group = { dictionary, termTags: [], entries: [] };
      groups.set(dictionary, group);
    }
    group.termTags = [...new Set([...group.termTags, ...splitTags(entry.termTags)])];
    group.entries.push({
      ...entry,
      definitionTagList: splitTags(entry.definitionTags),
    });
  }
  return [...groups.values()];
}

export interface RenderGlossaryMediaResource {
  src: string;
  alt?: string;
  title?: string;
}

export interface RenderGlossaryOptions {
  mediaResolver?: (dictionary: string, path: string) => RenderGlossaryMediaResource | null;
}

export function renderGlossaryContent(text: string, dictionary = "", options: RenderGlossaryOptions = {}): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return escapeHtml(text);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return renderStructuredContent(parsed, "", dictionary, options) || escapeHtml(text);
  } catch {
    return escapeHtml(text);
  }
}

export function scopeDictionaryCss(css: string, popupId: string): string {
  const scope = `[data-popup-id="${escapeCssString(popupId)}"] .lookup-glossary-content`;
  const cleaned = stripCssComments(css)
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(['"]?)https?:\/\/[^)]+\1\s*\)/gi, "none")
    .replace(/position\s*:\s*fixed\s*!?\s*[^;}]*/gi, "position: static");

  return scopeCssRules(cleaned, scope).trim();
}

function renderStructuredContent(value: unknown, parentTag = "", dictionary = "", options: RenderGlossaryOptions = {}): string {
  if (typeof value === "string") return renderText(value);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string") && value.length > 1 && parentTag !== "span") {
      return `<ul class="glossary-list">${value.map((item) => `<li>${renderText(item)}</li>`).join("")}</ul>`;
    }

    const items = value.map((item) => isStructuredContentWrapper(item) ? (item as { content?: unknown }).content : item);
    if (items.every((item) => isStructuredTag(item, "a")) && items.length > 1) {
      return `<ul class="glossary-list">${items.map((item) => `<li>${renderStructuredContent(item, "", dictionary, options)}</li>`).join("")}</ul>`;
    }

    return value.map((item) => renderStructuredContent(item, parentTag, dictionary, options)).join("");
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  if (record.type === "structured-content") {
    return `<span class="structured-content">${renderStructuredContent(record.content, "span", dictionary, options)}</span>`;
  }

  const tag = typeof record.tag === "string" ? record.tag.toLowerCase() : "";
  if (isStructuredImageRecord(record)) return renderStructuredImage(record, dictionary, options);
  const safeTag = safeStructuredTag(tag);
  if (safeTag === "br") return "<br>";

  const content = renderStructuredContent(
    typeof record.content !== "undefined" ? record.content : record.text,
    safeTag,
    dictionary,
    options,
  );
  const attributes = structuredAttributes(record, safeTag);
  const html = `<${safeTag}${attributes}>${content}</${safeTag}>`;
  if (safeTag === "table") return `<div class="gloss-sc-table-container">${html}</div>`;
  return html;
}

function isStructuredImageRecord(record: Record<string, unknown>): boolean {
  const tag = typeof record.tag === "string" ? record.tag.toLowerCase() : "";
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  return tag === "img" || tag === "image" || type === "image";
}

function renderStructuredImage(record: Record<string, unknown>, dictionary: string, options: RenderGlossaryOptions): string {
  const path = typeof record.path === "string"
    ? record.path
    : typeof record.src === "string"
      ? record.src
      : "";
  const title = typeof record.title === "string" ? record.title : path;
  const alt = typeof record.alt === "string" ? record.alt : title;
  const dataAttrs = structuredDataAttributes(record);
  const resolved = path ? options.mediaResolver?.(dictionary, path) ?? null : null;
  const statusAttr = resolved ? " data-media-status=\"loaded\"" : "";
  const pathAttr = path ? ` data-media-path="${escapeAttribute(path)}"` : "";
  const dictionaryAttr = dictionary ? ` data-media-dictionary="${escapeAttribute(dictionary)}"` : "";
  const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
  const displayAlt = resolved?.alt ?? alt;
  const image = resolved
    ? `<img class="gloss-image gloss-media-image" src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(displayAlt)}">`
    : `<span class="gloss-media-label">${escapeHtml(alt || "Dictionary media")}</span>`;
  const gaijiStyle = isGaijiImageRecord(record)
    ? ` style="width:1.15em !important;height:1.15em !important;margin-inline-end:0.15em;vertical-align:-0.15em;"`
    : "";
  return `<span${dataAttrs.length ? ` ${dataAttrs.join(" ")}` : ""}><a class="gloss-image-link gloss-media-placeholder"${pathAttr}${dictionaryAttr}${titleAttr}${statusAttr}><span class="gloss-image-container"${gaijiStyle}>${image}</span></a></span>`;
}

function renderText(text: string): string {
  return text.split(/\r?\n/).map(escapeHtml).join("<br>");
}

function safeStructuredTag(tag: string): string {
  const allowed = new Set([
    "a", "br", "div", "i", "li", "ol", "p", "ruby", "rt", "rp", "span", "table", "tbody",
    "td", "tfoot", "th", "thead", "tr", "ul",
  ]);
  return allowed.has(tag) ? tag : "span";
}

function structuredAttributes(record: Record<string, unknown>, tag: string): string {
  const classes = [`gloss-sc-${tag}`];
  const attrs = [`class="${classes.join(" ")}"`];
  if (tag === "a") {
    const href = typeof record.href === "string" ? record.href : "";
    if (/^https?:\/\//i.test(href)) {
      attrs.push(`href="${escapeAttribute(href)}" target="_blank" rel="noreferrer"`);
    } else {
      const redirectTarget = structuredRedirectTarget(record);
      if (redirectTarget) {
        attrs.push(`href="#" data-lookup-redirect="${escapeAttribute(redirectTarget)}"`);
      }
    }
  }
  if (typeof record.title === "string") attrs.push(`title="${escapeAttribute(record.title)}"`);
  if (typeof record.lang === "string") attrs.push(`lang="${escapeAttribute(record.lang)}"`);
  if (typeof record.colSpan === "number") attrs.push(`colspan="${record.colSpan}"`);
  if (typeof record.rowSpan === "number") attrs.push(`rowspan="${record.rowSpan}"`);
  if (typeof record.colspan === "number") attrs.push(`colspan="${record.colspan}"`);
  if (typeof record.rowspan === "number") attrs.push(`rowspan="${record.rowspan}"`);

  attrs.push(...structuredDataAttributes(record));
  const style = structuredStyleAttribute(record);
  if (style) attrs.push(`style="${escapeAttribute(style)}"`);

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

function structuredStyleAttribute(record: Record<string, unknown>): string {
  const style = record.style;
  if (!style || typeof style !== "object" || Array.isArray(style)) return "";

  const declarations: string[] = [];
  for (const [rawProperty, rawValue] of Object.entries(style as Record<string, unknown>)) {
    const property = toKebabCase(rawProperty);
    if (!isSafeStructuredStyleProperty(property)) continue;

    const value = structuredStyleValue(rawValue);
    if (!value || !isSafeStructuredStyleValue(value)) continue;
    declarations.push(`${property}: ${value}`);
  }

  return declarations.join("; ");
}

function isSafeStructuredStyleProperty(property: string): boolean {
  return property === "color"
    || property === "background-color"
    || property === "font-weight"
    || property === "font-style"
    || property === "font-size"
    || property === "text-align"
    || property === "vertical-align"
    || property === "text-decoration"
    || property.startsWith("margin-")
    || property.startsWith("padding-");
}

function structuredStyleValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function isSafeStructuredStyleValue(value: string): boolean {
  if (!value || value.length > 120) return false;
  if (/[;{}<>]/.test(value)) return false;
  if (/url\s*\(|image-set\s*\(|cross-fade\s*\(|paint\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)) {
    return false;
  }
  if (/[a-z-]+\s*\(/i.test(value) && !/^(?:rgb|rgba|hsl|hsla)\(\s*[-+.\d%\s,]+\)$/i.test(value)) {
    return false;
  }
  return true;
}

function structuredDataAttributes(record: Record<string, unknown>): string[] {
  const attrs: string[] = [];
  const data = record.data;
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      const prefix = /^[\u3000-\u9fff\uf900-\ufaff]/u.test(key) ? "data-sc" : "data-sc-";
      attrs.push(`${prefix}${toKebabCase(key)}="${escapeAttribute(String(value))}"`);
    }
  }
  return attrs;
}

function isGaijiImageRecord(record: Record<string, unknown>): boolean {
  const data = record.data;
  if (!data || typeof data !== "object") return false;
  const fields = data as Record<string, unknown>;
  return fields.gaiji !== undefined || fields.class === "gaiji";
}

function structuredRedirectTarget(record: Record<string, unknown>): string {
  const data = record.data;
  if (data && typeof data === "object") {
    for (const key of ["query", "term", "expression", "headword", "content"]) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  const href = typeof record.href === "string" ? record.href.trim() : "";
  if (href) {
    const query = redirectQueryFromHref(href);
    if (query) return query;
  }

  const text = structuredPlainText(typeof record.content !== "undefined" ? record.content : record.text);
  return text.trim();
}

function redirectQueryFromHref(href: string): string {
  try {
    const url = new URL(href, "https://lookup.invalid/");
    for (const key of ["query", "q", "term", "expression"]) {
      const value = url.searchParams.get(key);
      if (value?.trim()) return value.trim();
    }
  } catch {
    // Fall through to raw href handling below.
  }

  if (!/[/?#]/.test(href)) return href;
  return "";
}

function structuredPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(structuredPlainText).join("");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return structuredPlainText(typeof record.content !== "undefined" ? record.content : record.text);
}

function isStructuredContentWrapper(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as Record<string, unknown>).type === "structured-content";
}

function isStructuredTag(value: unknown, tag: string): boolean {
  return !!value && typeof value === "object" && (value as Record<string, unknown>).tag === tag;
}

function toKebabCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function scopeCssRules(css: string, scope: string): string {
  let output = "";
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open < 0) break;
    const selector = css.slice(index, open).trim();
    const close = matchingBrace(css, open);
    if (close < 0) break;
    const body = css.slice(open + 1, close).trim();
    index = close + 1;

    if (!selector || !body) continue;
    if (selector.toLowerCase().startsWith("@media")) {
      const inner = scopeCssRules(body, scope);
      if (inner) output += `${selector}{${inner}}\n`;
      continue;
    }
    if (selector.startsWith("@")) continue;

    const scopedSelector = selector
      .split(",")
      .map((item) => scopeCssSelector(item.trim(), scope))
      .filter(Boolean)
      .join(", ");
    if (!scopedSelector) continue;
    const safeBody = sanitizeDictionaryCssBody(body);
    if (!safeBody) continue;
    output += `${scopedSelector}{${safeBody}}\n`;
  }
  return output;
}

function sanitizeDictionaryCssBody(body: string): string {
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator <= 0) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      return !isUnsafeDictionaryCssProperty(property);
    })
    .join(";");
}

function isUnsafeDictionaryCssProperty(property: string): boolean {
  return property === "font-size"
    || property === "width"
    || property === "height"
    || property === "min-width"
    || property === "min-height"
    || property === "max-width"
    || property === "max-height"
    || property === "position"
    || property === "inset"
    || property === "top"
    || property === "right"
    || property === "bottom"
    || property === "left"
    || property === "transform"
    || property === "translate"
    || property === "scale"
    || property === "rotate"
    || property === "zoom"
    || property === "writing-mode"
    || property === "line-height";
}

function matchingBrace(css: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    const previous = css[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function scopeCssSelector(selector: string, scope: string): string {
  if (!selector || /(^|[\s>+~,(])(?:html|body|:root)(?=$|[\s>+~,#.[:)])/i.test(selector)) return "";
  if (/^\*/.test(selector)) return `${scope} ${selector}`;
  return `${scope} ${selector}`;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
