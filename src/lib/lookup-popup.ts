import type { DictResult } from "./types";

export type LookupState = "idle" | "loading" | "ready" | "empty" | "error" | "noDictionaries" | "engineUnavailable";

export function formatLookupMatch(result: DictResult): string {
  if (result.matched && result.deinflected && result.matched !== result.deinflected) {
    return `${result.matched} -> ${result.deinflected}`;
  }
  return result.matched || result.deinflected || "";
}

export function frequencyLabel(result: DictResult): string {
  const entry = result.frequencies.find((frequency) => frequency.items.length > 0);
  if (!entry) return "";

  const values = entry.items
    .slice(0, 3)
    .map((item) => item.displayValue || String(item.value))
    .filter(Boolean);
  if (values.length === 0) return "";
  return `${entry.dictionary}: ${values.join(", ")}`;
}

export function pitchLabel(result: DictResult): string {
  const entry = result.pitches.find((pitch) => pitch.positions.length > 0 || pitch.transcriptions.length > 0);
  if (!entry) return "";

  const details = [
    entry.positions.length > 0 ? `pitch ${entry.positions.join(", ")}` : "",
    entry.transcriptions.slice(0, 2).join(", "),
  ].filter(Boolean);
  if (details.length === 0) return "";
  return `${entry.dictionary}: ${details.join(" | ")}`;
}

export function resultDictionaryLabel(result: DictResult): string {
  return result.dictionary || result.glossary[0]?.dict || result.frequencies[0]?.dictionary || result.pitches[0]?.dictionary || "";
}

export function renderGlossaryContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return escapeHtml(text);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return renderStructuredContent(parsed) || escapeHtml(text);
  } catch {
    return escapeHtml(text);
  }
}

function renderStructuredContent(value: unknown, parentTag = ""): string {
  if (typeof value === "string") return renderText(value);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string") && value.length > 1 && parentTag !== "span") {
      return `<ul class="glossary-list">${value.map((item) => `<li>${renderText(item)}</li>`).join("")}</ul>`;
    }

    const items = value.map((item) => isStructuredContentWrapper(item) ? (item as { content?: unknown }).content : item);
    if (items.every((item) => isStructuredTag(item, "a")) && items.length > 1) {
      return `<ul class="glossary-list">${items.map((item) => `<li>${renderStructuredContent(item)}</li>`).join("")}</ul>`;
    }

    return value.map((item) => renderStructuredContent(item, parentTag)).join("");
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  if (record.type === "structured-content") {
    return `<span class="structured-content">${renderStructuredContent(record.content, "span")}</span>`;
  }

  const tag = typeof record.tag === "string" ? record.tag.toLowerCase() : "";
  const safeTag = safeStructuredTag(tag);
  if (safeTag === "br") return "<br>";

  const content = renderStructuredContent(
    typeof record.content !== "undefined" ? record.content : record.text,
    safeTag,
  );
  const attributes = structuredAttributes(record, safeTag);
  const html = `<${safeTag}${attributes}>${content}</${safeTag}>`;
  if (safeTag === "table") return `<div class="gloss-sc-table-container">${html}</div>`;
  return html;
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
  const attrs = [`class="gloss-sc-${tag}"`];
  if (tag === "a" && typeof record.href === "string" && /^https?:\/\//i.test(record.href)) {
    attrs.push(`href="${escapeAttribute(record.href)}" target="_blank" rel="noreferrer"`);
  }
  if (typeof record.title === "string") attrs.push(`title="${escapeAttribute(record.title)}"`);
  if (typeof record.lang === "string") attrs.push(`lang="${escapeAttribute(record.lang)}"`);
  if (typeof record.colSpan === "number") attrs.push(`colspan="${record.colSpan}"`);
  if (typeof record.rowSpan === "number") attrs.push(`rowspan="${record.rowSpan}"`);

  const data = record.data;
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      attrs.push(`data-sc-${toKebabCase(key)}="${escapeAttribute(String(value))}"`);
    }
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
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
