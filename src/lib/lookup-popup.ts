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

interface StructuredImageLayout {
  usedWidth: number;
  invAspectRatio: number;
  hasDimensions: boolean;
  hasPreferredWidth: boolean;
  hasPreferredHeight: boolean;
  sizeUnits: "px" | "em";
  imageRendering: string;
  appearance: string;
  background: boolean;
  collapsed: boolean;
  collapsible: boolean;
  verticalAlign: string;
  border: string;
  borderRadius: string;
}

export function renderGlossaryContent(text: string, dictionary = "", options: RenderGlossaryOptions = {}): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return renderText(text);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return renderStructuredContent(parsed, "", dictionary, options) || renderText(text);
  } catch {
    return renderText(text);
  }
}

export function scopeDictionaryCss(css: string, popupId: string, dictionary: string): string {
  const scope = `[data-popup-id="${escapeCssString(popupId)}"] [data-dictionary="${escapeCssString(dictionary)}"] .lookup-glossary-content`;
  const cleaned = stripCssComments(css)
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(['"]?)https?:\/\/[^)]+\1\s*\)/gi, "none")
    .replace(/position\s*:\s*fixed\s*!?\s*[^;}]*/gi, "position: static");

  return scopeCssRules(cleaned, scope).trim();
}

function renderStructuredContent(
  value: unknown,
  parentTag = "",
  dictionary = "",
  options: RenderGlossaryOptions = {},
  language: string | null = null,
): string {
  if (typeof value === "string") return renderText(value, language);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string") && value.length > 1 && parentTag !== "span") {
      return `<ul class="glossary-list">${value.map((item) => `<li>${renderText(item, language)}</li>`).join("")}</ul>`;
    }

    const items = value.map((item) => isStructuredContentWrapper(item) ? (item as { content?: unknown }).content : item);
    if (items.every((item) => isStructuredTag(item, "a")) && items.length > 1) {
      return `<ul class="glossary-list">${items.map((item) => `<li>${renderStructuredContent(item, "", dictionary, options, language)}</li>`).join("")}</ul>`;
    }

    return value.map((item) => renderStructuredContent(item, parentTag, dictionary, options, language)).join("");
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  if (record.type === "structured-content") {
    return `<span class="structured-content">${renderStructuredContent(record.content, "span", dictionary, options, language)}</span>`;
  }

  const tag = typeof record.tag === "string" ? record.tag.toLowerCase() : "";
  if (isStructuredImageRecord(record)) return renderStructuredImage(record, dictionary, options);
  const safeTag = safeStructuredTag(tag);
  if (safeTag === "br") return "<br>";

  const explicitLanguage = typeof record.lang === "string" ? normalizedLanguage(record.lang) : null;
  const nextLanguage = explicitLanguage ?? language;
  const content = renderStructuredContent(
    typeof record.content !== "undefined" ? record.content : record.text,
    safeTag,
    dictionary,
    options,
    nextLanguage,
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
  const layout = structuredImageLayout(record);
  const dataAttrs = structuredDataAttributes(record);
  const resolved = path ? options.mediaResolver?.(dictionary, path) ?? null : null;
  const statusAttr = resolved ? " data-media-status=\"loaded\"" : "";
  const pathAttr = path ? ` data-media-path="${escapeAttribute(path)}"` : "";
  const dictionaryAttr = dictionary ? ` data-media-dictionary="${escapeAttribute(dictionary)}"` : "";
  const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
  const imageDataAttrs = [
    `data-has-aspect-ratio="true"`,
    `data-image-rendering="${escapeAttribute(layout.imageRendering)}"`,
    `data-appearance="${escapeAttribute(layout.appearance)}"`,
    `data-background="${layout.background}"`,
    `data-collapsed="${layout.collapsed}"`,
    `data-collapsible="${layout.collapsible}"`,
    `data-has-structured-dimensions="${layout.hasDimensions}"`,
    `data-has-preferred-width="${layout.hasPreferredWidth}"`,
    `data-has-preferred-height="${layout.hasPreferredHeight}"`,
  ];
  if (layout.verticalAlign) imageDataAttrs.push(`data-vertical-align="${escapeAttribute(layout.verticalAlign)}"`);
  if (layout.sizeUnits === "em") imageDataAttrs.push(`data-size-units="em"`);
  const displayAlt = resolved?.alt ?? alt;
  const imageStyle = layout.appearance === "monochrome" ? " style=\"opacity:0\"" : "";
  const image = resolved
    ? `<img class="gloss-image gloss-media-image" src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(displayAlt)}"${imageStyle}>`
    : `<span class="gloss-media-label">${escapeHtml(alt || "Dictionary media")}</span>`;
  const containerStyle = structuredImageContainerStyle(layout);
  const sizerStyle = `padding-top:${formatCssNumber(layout.invAspectRatio * 100)}%`;
  const backgroundStyle = resolved && layout.appearance === "monochrome"
    ? ` style="--gloss-image-url:url(&quot;${escapeAttribute(resolved.src)}&quot;)"`
    : "";
  return `<span${dataAttrs.length ? ` ${dataAttrs.join(" ")}` : ""}><a class="gloss-image-link gloss-media-placeholder"${pathAttr}${dictionaryAttr}${titleAttr}${statusAttr} ${imageDataAttrs.join(" ")}><span class="gloss-image-container" style="${escapeAttribute(containerStyle)}"><span class="gloss-image-sizer" style="${escapeAttribute(sizerStyle)}"></span><span class="gloss-image-background"${backgroundStyle}></span><span class="gloss-image-container-overlay"></span>${image}</span></a></span>`;
}

function structuredImageLayout(record: Record<string, unknown>): StructuredImageLayout {
  const width = positiveNumber(record.width, 100) ?? 100;
  const height = positiveNumber(record.height, 100) ?? 100;
  const preferredWidth = positiveNumber(record.preferredWidth);
  const preferredHeight = positiveNumber(record.preferredHeight);
  const hasPreferredWidth = typeof preferredWidth === "number";
  const hasPreferredHeight = typeof preferredHeight === "number";
  const hasDimensions = hasPreferredWidth || hasPreferredHeight || typeof record.width === "number" || typeof record.height === "number";
  const invAspectRatio = positiveRatio(
    hasPreferredWidth && hasPreferredHeight
      ? preferredHeight / preferredWidth
      : height / width,
  );
  const usedWidth = positiveRatio(
    hasPreferredWidth
      ? preferredWidth
      : hasPreferredHeight
        ? preferredHeight / invAspectRatio
        : width,
  );
  const imageRendering = typeof record.imageRendering === "string"
    ? record.imageRendering
    : record.pixelated === true
      ? "pixelated"
      : "auto";

  return {
    usedWidth,
    invAspectRatio,
    hasDimensions,
    hasPreferredWidth,
    hasPreferredHeight,
    sizeUnits: record.sizeUnits === "em" || isGaijiImageRecord(record) ? "em" : "px",
    imageRendering,
    appearance: typeof record.appearance === "string" ? record.appearance : "auto",
    background: typeof record.background === "boolean" ? record.background : true,
    collapsed: typeof record.collapsed === "boolean" ? record.collapsed : false,
    collapsible: typeof record.collapsible === "boolean" ? record.collapsible : true,
    verticalAlign: typeof record.verticalAlign === "string" ? record.verticalAlign : "",
    border: typeof record.border === "string" && isSafeStructuredStyleValue(record.border) ? record.border : "",
    borderRadius: typeof record.borderRadius === "string" && isSafeStructuredStyleValue(record.borderRadius) ? record.borderRadius : "",
  };
}

function structuredImageContainerStyle(layout: StructuredImageLayout): string {
  const declarations = [
    `width:${formatCssNumber(layout.usedWidth)}${layout.sizeUnits}`,
  ];
  if (layout.sizeUnits === "em") declarations.push("font-size:1em");
  if (layout.verticalAlign && isSafeStructuredStyleValue(layout.verticalAlign)) {
    declarations.push(`vertical-align:${layout.verticalAlign}`);
  }
  if (layout.border) declarations.push(`border:${layout.border}`);
  if (layout.borderRadius) declarations.push(`border-radius:${layout.borderRadius}`);
  return declarations.join(";");
}

function positiveNumber(value: unknown, fallback?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.min(value, 10000);
  return fallback;
}

function positiveRatio(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, 10000) : 1;
}

function formatCssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function renderText(text: string, language: string | null = null): string {
  return text.split(/\r?\n/).map((line) => {
    const escaped = escapeHtml(line);
    if (!line) return escaped;
    const detected = normalizedLanguage(language) ?? languageFromText(line);
    if (!detected) return escaped;
    return `<span lang="${escapeAttribute(detected)}">${escaped}</span>`;
  }).join("<br>");
}

function safeStructuredTag(tag: string): string {
  const allowed = new Set([
    "a", "b", "br", "details", "div", "em", "i", "li", "ol", "p", "ruby", "rt", "rp",
    "span", "strong", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
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
      attrs.push(`${structuredDataAttributeName(key)}="${escapeAttribute(String(value))}"`);
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

function toStructuredDataKey(value: string): string {
  return value
    .replace(/([A-Z])/g, (_, c, offset) => `${offset ? "-" : ""}${c.toLowerCase()}`)
    .replace(/[\u0000-\u001f\u007f\s"'<>/=]+/g, "-");
}

function structuredDataAttributeName(key: string): string {
  const prefix = /^[\u3000-\u9fff\uf900-\ufaff]/u.test(key) ? "data-sc" : "data-sc-";
  return `${prefix}${toStructuredDataKey(key)}`;
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

function normalizedLanguage(language: string | null | undefined): string | null {
  if (!language) return null;
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("zh") || normalized.startsWith("yue")) return normalized;
  return normalized || null;
}

function languageFromText(text: string): string | null {
  if (/[ぁ-ゖァ-ヺｦ-ﾟ]/u.test(text)) return "ja";
  if (/[\u3100-\u312f\u31a0-\u31bf]/u.test(text)) return "zh";
  if (simplifiedOnlyCount(text) >= 2) return "zh";
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆〤]/u.test(text)) return "ja";
  return null;
}

function simplifiedOnlyCount(text: string): number {
  let count = 0;
  for (const char of text) {
    if (SIMPLIFIED_ONLY_CHARS.has(char)) count += 1;
  }
  return count;
}

const SIMPLIFIED_ONLY_CHARS = new Set(Array.from(
  "汉语国双译释义词条辞典书页页码号项旧归补修饰装门报认设让讲读过边这进还连选远对错长发丽乌乐乔习乡买乱争于亏云亚产亩亲亵亸亿仅从仓仪们价众优会伞伟传伤伦伪体余佣佥侠侣侥侦侧侨侩侪侬俣俦俨俩俪俭债倾偬偻偾偿傥傧储傩儿兑兖党兰关兴兹养兽冁内冈册写军农冯冲决况冻净凄准凉减凑凛凤凫凭凯击凿刍划刘则刚创删别刬刭刮制剂剐剑剥剧劝办务劢动励劲劳势勋勐勚匀匦匮区医华协单卖卢卤卫却厂厅历厉压厌厍厕厢厣厦厨厩厮县参叆叇双发变叙叠只台叶号叹叽吁后吓吕吗吣吨听启吴呐呒呓呕呖呗员呙呛呜咏咙咛咝咤响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唤啧啬啭啮啰啴啸喷喽喾嗫嗳嘘嘤嘱噜噼嚣团园囱围囵国图圆圣圹场坏块坚坛坝坞坟坠垄垅垆垒垦垩垫垭垯垱垲垴埘埙埚埯堑堕塆墙壮声壳壶壸处备复够头夹夺奁奂奋奖奥妆妇妈妩妪妫姗姜娄娅娆娇娈娱娲娴婳婴婵婶媪嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝尧尴尸尽层屃屉届属屡屦屿岁岂岖岗岘岙岚岛岭岳岽岿峃峄峡峣峤峥峦崂崃崭嵘嵚嵝巅巩巯币帅师帐帏帜带帧帮帱帻帼幂并广庄庆庐庑库应庙庞废庼廪开异弃张弥弪弯弹强归当录彟彦彻径徕忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恒恳恶恸恹恺恻恼恽悦悫悬悭悯惊惧惨惩惫惬惭惮惯愠愤愦愿慑懑懒懔戆戋戏戗战戬户扎扑执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捞损捡换捣据捻掳掴掷掸掺掼揽揿搀搁搂搅携摄摅摆摇摈摊撄撑撵撷撸撺擞攒敌敛数斋斓斗斩断无旧时旷旸昙昼显晋晒晓晔晕晖暂暧术机杀杂权杆条来杨杩杰极构枞枢枣枥枧枨枪枫枭柜柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桊桠桡桢档桤桥桦桧桨桩梦梼梾检棂椁椟椠椤椭楼榄榅榇榈榉槚槛槟槠横樯樱橥橱橹橼檩欢欤欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵氇气氢氩氲汇汉污汤汹沟没沣沤沥沦沧沨沩沪泞注泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浊测浍济浏浐浑浒浓浔浕涂涌涛涝涞涟涠涡涣涤润涧涨涩淀渊渌渍渎渐渑渔渖渗温湾湿溃溅溆滗滚滞滟滠满滢滤滥滦滨滩滪漓漤潆潇潋潍潜潴澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煴爱爷牍牦牵牺犊状犷犸犹狈狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玚玛玮环现玱玺珐珑珰珲琏琐琼瑶瑷璎瓒瓯电画畅畴疖疗疟疠疡疬疮疯疱疴痈痉痒痨痪痫瘅瘆瘗瘘瘪瘫瘾瘿癞癣皑皱皲盏盐监盖盗盘眍眦睁睐睑瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硕硖硗硙硚确硷碍碛碜碱礼祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筑筚筛筜筝筹签简箓箦箧箨箩箪箫篑篮篱簖籁籴类籼粜粝粤粪粮糁糇紧絷纟纠纡红纣纤纥约级纨纩纪纫纬纭纯纰纱纲纳纵纶纷纸纹纺纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绑绒结绕绗绘给绚络绝绞统绠绡绢绣绥绦继绩绪绫续绮绯绰绲绳维绵绶绷绸综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缍缎缏缑缒缓缔缕编缗缘缙缚缛缜缝缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴罂网罗罚罢罴羁羟羡翘耢耧耸耻聂职聍联聪肃肠肤肷肾肿胀胁胆胜胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸腊腌腘腭腻腼腾膑臜舆舣舰舱舻艰艳艺节芈芗芜芦苁苇苈苋苌苍苎苏苧苹茎茏茑茔茕茧荆荐荙荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药莅莱莲莳莴莶获莸莹莺莼萝萤营萦萧萨葱蒇蒉蒋蒌蓝蓟蓠蓣蓥蓦蔑蔷蔹蔺蔼蕲蕴薮藓虏虑虚虫虬虮虽虾虿蚀蚁蚂蚕蚝蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蜡蝇蝈蝉蝎蝼蝾螀螨蟏衅衔补衬衮袄袅袆袜袭袯装裆裈裢裣裤裥褛褴襁见观规觅视觇览觉觊觋觌觎觏觐觑觞触觯訚誉誊讠计订讣认讥讦讧讨让讪讫训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诈诉诊诋诌词诎诏译诒诓诔试诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵请诸诺读诽课诿谀谁调谄谅谆谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谞谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谷豮贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赔赖赘赙赚赛赞赠赡赢赣赵赶趋趱趸跃跄跞践跷跸跹跻踊踌踪踬蹑蹒蹰蹿躏躜车轧轨轩轫转轭轮软轰轱轲轳轴轵轶轸轹轻轼载轾轿辁辂较辄辅辆辇辈辉辊辋辍辎辏辐辑输辔辕辖辗辘辙辚辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选逊递逦逻遗遥邓邝邬邮邹邺邻郏郐郑郓郦郧郸酝酦酱酽酾酿释里鉴銮錾钅针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钜钝钞钟钠钢钡钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铌铍铎铐铑铒铕铖铗铙铛铜铝铞铟铠铡铢铣铤铥铦铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锅锈锉锋锌锍锎锏锐锑锒锓锔锕锖锗错锚锛锜锝锞锟锡锢锣锤锥锦锨锩锪锫锬锭键锯锰锱锲锴锵锶锷锸锹锻锼锾锿镀镁镂镇镉镌镍镎镏镐镑镒镓镔镖镗镘镙镚镜镝镞镟镡镢镤镥镦镧镨镩镪镫镬镭镯镰镱镲镳长门闩闪闫闭问闯闰闲间闵闷闸闹闺闻闼闽闾阀阁阂阅阆阈阉阊阋阌阍阎阏阐阑阒阔阕阖阗阙阚队阳阴阵阶际陆陇陈陉陕陧陨险随隐隶隽难雏雠雳雾霁霉静靥鞑鞒鞯韦韧韩韪韫韬韵页顶顷顸项顺须顼顽顾顿颀颁颂预颅领颇颈颉颊颌颍颏频颓颖颗题额颚颛颜颙颠颡颢颤颥颦风飏飐飑飒飓飔飕飖飘飙飚飞飨餍饣饥饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饿馁馄馅馆馈馊馋馍馏馐馑馒馓馔馕马驭驮驯驰驱驳驴驶驷驸驹驻驼驽驾驿骀骁骂骄骅骆骇骈骊验骎骏骐骑骒骓骖骗骘骚骛骜骝骟骠骡骢骣骤骥骧髅髋髌鬓魇鱼鱽鱾饿鲁鲂鲅鲆鲇鲈鲊鲋鲍鲎鲐鲑鲒鲔鲕鲚鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲺鲻鲼鲽鲾鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳝鳞鳟鳢鸟鸠鸡鸢鸣鸥鸦鸧鸨鸩鸪鸫鸬鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹏鹐鹑鹒鹕鹗鹘鹚鹛鹜鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹯鹰鹱鹳鹾麦麸黄黉黡黩黪黾鼋鼍鼗鼹齐齑齿龀龁龂龄龅龆龇龈龉龊龋龌龙龚龛龟",
));

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
