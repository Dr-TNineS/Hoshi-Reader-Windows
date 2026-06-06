import { convertFileSrc } from "@tauri-apps/api/core";

export function normalizeHref(href: string): string {
  return decodeURI(href)
    .split("#")[0]
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function isExternalAssetUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|#|data:|blob:)/i.test(url);
}

function isInternalChapterHref(href: string): boolean {
  const path = href.split("#")[0];
  return /\.(?:x?html?|xht)$/i.test(path);
}

function chapterDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

function resolveAssetPath(baseFile: string, assetUrl: string): string {
  const parts = `${chapterDir(baseFile)}/${decodeUrlPath(assetUrl)}`.replace(/\\/g, "/").split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const prefix = /^[A-Za-z]:\//.test(resolved.join("/")) ? "" : "/";
  return `${prefix}${resolved.join("/")}`;
}

function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const query = url.indexOf("?");
  const hash = url.indexOf("#");
  const cut = [query, hash].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
  return cut === undefined
    ? { path: url, suffix: "" }
    : { path: url.slice(0, cut), suffix: url.slice(cut) };
}

function decodeUrlPath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function resolveAssetUrl(baseFile: string, assetUrl: string): string {
  const { path, suffix } = splitUrlSuffix(assetUrl);
  return `${convertFileSrc(resolveAssetPath(baseFile, path))}${suffix}`;
}

function rewriteUrlAttribute(el: Element, attr: string, chapterPath: string) {
  const value = el.getAttribute(attr);
  if (!value || isExternalAssetUrl(value)) return;
  if (attr === "href" && isInternalChapterHref(value)) {
    el.setAttribute("data-epub-href", value);
    el.setAttribute("href", "#");
    return;
  }
  const resolved = resolveAssetUrl(chapterPath, value);
  el.setAttribute(attr, resolved);
  if (attr === "xlink:href") {
    el.setAttribute("href", resolved);
    el.setAttributeNS("http://www.w3.org/1999/xlink", "href", resolved);
  }
}

function rewriteSrcsetAttribute(el: Element, chapterPath: string) {
  const value = el.getAttribute("srcset");
  if (!value) return;
  const rewritten = value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const url = parts.shift();
      if (!url || isExternalAssetUrl(url)) return candidate.trim();
      return [resolveAssetUrl(chapterPath, url), ...parts].join(" ");
    })
    .join(", ");
  el.setAttribute("srcset", rewritten);
}

function sanitizeInlineStyleAttribute(el: Element) {
  const value = el.getAttribute("style");
  if (!value) return;

  const cleaned = value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const property = declaration.split(":")[0]?.trim().toLowerCase();
      return property !== "writing-mode" && property !== "-webkit-writing-mode" && property !== "-epub-writing-mode";
    })
    .join("; ");

  if (cleaned) el.setAttribute("style", cleaned);
  else el.removeAttribute("style");
}

function replaceSingleImageSvgs(doc: Document, chapterPath: string) {
  doc.querySelectorAll("svg").forEach((svg) => {
    const images = Array.from(svg.querySelectorAll("image"));
    if (images.length !== 1) return;
    if (Array.from(svg.children).some((child) => child.localName.toLowerCase() !== "image")) return;

    const image = images[0];
    const src = image.getAttribute("href") ?? image.getAttribute("xlink:href");
    if (!src) return;

    const img = doc.createElement("img");
    img.setAttribute("src", isExternalAssetUrl(src) ? src : resolveAssetUrl(chapterPath, src));
    img.setAttribute("class", "epub-svg-cover-img");
    img.setAttribute("loading", "eager");
    img.setAttribute("decoding", "sync");
    svg.replaceWith(img);
  });
}

export function resolveChapterAssets(html: string, chapterPath: string | null): string {
  if (!chapterPath) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("[src]").forEach((el) => rewriteUrlAttribute(el, "src", chapterPath));
  doc.querySelectorAll("[srcset]").forEach((el) => rewriteSrcsetAttribute(el, chapterPath));
  doc.querySelectorAll("[href]").forEach((el) => rewriteUrlAttribute(el, "href", chapterPath));
  doc.querySelectorAll("[poster]").forEach((el) => rewriteUrlAttribute(el, "poster", chapterPath));
  doc.querySelectorAll("[xlink\\:href]").forEach((el) => rewriteUrlAttribute(el, "xlink:href", chapterPath));
  doc.querySelectorAll("[style]").forEach(sanitizeInlineStyleAttribute);
  replaceSingleImageSvgs(doc, chapterPath);
  doc.querySelectorAll("img.gaiji").forEach((el) => {
    el.setAttribute("width", "1");
    el.setAttribute("height", "1");
    el.setAttribute("loading", "eager");
    el.setAttribute("decoding", "sync");
  });
  doc.querySelectorAll("img.gaiji-line").forEach((el) => {
    el.setAttribute("width", "1");
    el.setAttribute("loading", "eager");
    el.setAttribute("decoding", "sync");
  });
  const bodyClasses = Array.from(doc.body.classList)
    .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
    .map((name) => `epub-body-${name}`)
    .join(" ");
  const bodyId = doc.body.id ? ` data-epub-body-id="${doc.body.id.replace(/"/g, "&quot;")}"` : "";
  return `<div class="epub-body ${bodyClasses}"${bodyId}>${doc.body.innerHTML}</div>`;
}
