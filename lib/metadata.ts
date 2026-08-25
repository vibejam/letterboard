import dns from "node:dns/promises";
import net from "node:net";
import { normalizeNewsletterUrl } from "./urls.ts";

export type LogoSource = "og:image" | "twitter:image" | "favicon" | "apple-touch-icon" | "json-ld" | "platform" | "monogram";
export type LogoCandidate = { url: string; source: Exclude<LogoSource, "monogram"> };

const MAX_HTML_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

function isPrivate(host: string) {
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;
  const ip = net.isIP(host);
  if (ip === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (ip === 6) {
    const normalized = host.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return false;
}

async function assertPublicHost(hostname: string) {
  if (isPrivate(hostname)) throw new Error("UNSUPPORTED_URL");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivate(address))) throw new Error("UNSUPPORTED_URL");
}

async function safeFetch(input: URL, init: RequestInit = {}, httpsOnly = false) {
  let current = input;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!['http:', 'https:'].includes(current.protocol) || (httpsOnly && current.protocol !== "https:")) throw new Error("UNSUPPORTED_URL");
    await assertPublicHost(current.hostname);
    const response = await fetch(current, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(7000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirect === MAX_REDIRECTS) throw new Error("METADATA_UNAVAILABLE");
    current = new URL(location, current);
  }
  throw new Error("METADATA_UNAVAILABLE");
}

async function readCappedBody(response: Response, limit: number) {
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error("METADATA_UNAVAILABLE"); }
      chunks.push(next.value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  }
  const output = new Uint8Array(await response.arrayBuffer());
  if (output.byteLength > limit) throw new Error("METADATA_UNAVAILABLE");
  return output;
}

function htmlFromBytes(bytes: Uint8Array) { return new TextDecoder().decode(bytes); }

function attributes(tag: string) {
  const found = new Map<string, string>();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) found.set(match[1].toLowerCase(), (match[2] ?? match[3] ?? match[4] ?? "").trim());
  return found;
}

function tags(html: string, name: string) { return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => match[0]); }

function metaValue(html: string, names: string[]) {
  for (const tag of tags(html, "meta")) {
    const attrs = attributes(tag);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    if (names.includes(key)) return attrs.get("content") || null;
  }
  return null;
}

function linkValue(html: string, rels: string[]) {
  for (const tag of tags(html, "link")) {
    const attrs = attributes(tag);
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.some((value) => rels.includes(value))) return attrs.get("href") || null;
  }
  return null;
}

function findJsonLdLogo(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) { for (const item of value) { const found = findJsonLdLogo(item); if (found) return found; } return null; }
  const record = value as Record<string, unknown>;
  const publisher = record.publisher;
  if (publisher && typeof publisher === "object") {
    const logo = (publisher as Record<string, unknown>).logo;
    if (typeof logo === "string") return logo;
    if (logo && typeof logo === "object" && typeof (logo as Record<string, unknown>).url === "string") return (logo as Record<string, string>).url;
  }
  if (typeof record.logo === "string") return record.logo;
  if (record.logo && typeof record.logo === "object" && typeof (record.logo as Record<string, unknown>).url === "string") return (record.logo as Record<string, string>).url;
  for (const child of Object.values(record)) { const found = findJsonLdLogo(child); if (found) return found; }
  return null;
}

function jsonLdLogo(html: string) {
  for (const script of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const found = findJsonLdLogo(JSON.parse(script[1])); if (found) return found; } catch { /* malformed JSON-LD is not a failure */ }
  }
  return null;
}

export function extractLogoCandidates(html: string): LogoCandidate[] {
  const candidates: LogoCandidate[] = [];
  const add = (value: string | null, source: LogoCandidate["source"]) => { if (value && !candidates.some((candidate) => candidate.url === value)) candidates.push({ url: value, source }); };
  add(metaValue(html, ["og:image", "og:image:url"]), "og:image");
  add(metaValue(html, ["twitter:image", "twitter:image:src"]), "twitter:image");
  add(linkValue(html, ["icon", "shortcut", "image_src"]), "favicon");
  add(linkValue(html, ["apple-touch-icon", "apple-touch-icon-precomposed"]), "apple-touch-icon");
  add(jsonLdLogo(html), "json-ld");
  add(metaValue(html, ["substack:logo", "profile:image", "publication:image"]), "platform");
  return candidates;
}

function dimensions(bytes: Uint8Array, contentType: string) {
  if (contentType.includes("svg")) {
    const source = htmlFromBytes(bytes.slice(0, 16_384));
    const tag = source.match(/<svg\b[^>]*>/i)?.[0] ?? "";
    const number = (value: string | undefined) => value ? Number.parseFloat(value) : NaN;
    const width = number(tag.match(/\bwidth\s*=\s*["']\s*([0-9.]+)/i)?.[1]);
    const height = number(tag.match(/\bheight\s*=\s*["']\s*([0-9.]+)/i)?.[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
    const viewBox = tag.match(/\bviewBox\s*=\s*["']\s*([0-9.eE+\-\s]+)["']/i)?.[1]?.trim().split(/\s+/).map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return { width: viewBox[2], height: viewBox[3] };
  }
  if (contentType.includes("png") && bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType.includes("gif") && bytes.length >= 10) return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  if (contentType.includes("webp") && bytes.length >= 30 && htmlFromBytes(bytes.slice(0, 4)) === "RIFF" && htmlFromBytes(bytes.slice(12, 16)) === "VP8X") {
    return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
  }
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    for (let index = 2; index + 9 < bytes.length;) {
      if (bytes[index] !== 0xff) { index += 1; continue; }
      const marker = bytes[index + 1];
      const length = (bytes[index + 2] << 8) + bytes[index + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[index + 5] << 8) + bytes[index + 6], width: (bytes[index + 7] << 8) + bytes[index + 8] };
      index += Math.max(2, length);
    }
  }
  return null;
}

async function validateImageCandidate(value: string, base: URL) {
  let url: URL;
  try { url = new URL(value, base); } catch { return null; }
  if (url.protocol !== "https:") return null;
  try {
    const response = await safeFetch(url, { headers: { accept: "image/avif,image/webp,image/apng,image/*" }, signal: AbortSignal.timeout(7000) }, true);
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!type.startsWith("image/")) return null;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const bytes = await readCappedBody(response, MAX_IMAGE_BYTES);
    const size = dimensions(bytes, type);
    if (!size || size.width < 16 || size.height < 16 || size.width > 4096 || size.height > 4096) return null;
    return { url: url.toString(), width: size.width, height: size.height };
  } catch { return null; }
}

export async function resolvePublicMetadata(input: string) {
  const normalized = normalizeNewsletterUrl(input);
  const url = new URL(normalized.canonicalUrl);
  const response = await safeFetch(url, { headers: { accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(7000) }, true);
  if (!response.ok) throw new Error("METADATA_UNAVAILABLE");
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("text/html") && !type.toLowerCase().includes("application/xhtml+xml")) throw new Error("UNSUPPORTED_URL");
  const html = htmlFromBytes(await readCappedBody(response, MAX_HTML_BYTES));
  const title = metaValue(html, ["og:title", "twitter:title"]) ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url.hostname;
  const description = metaValue(html, ["og:description", "twitter:description", "description"]);
  let logoUrl: string | null = null;
  let logoSource: LogoSource = "monogram";
  let logoWidth: number | null = null;
  let logoHeight: number | null = null;
  for (const candidate of extractLogoCandidates(html)) {
    const valid = await validateImageCandidate(candidate.url, url);
    if (valid) { logoUrl = valid.url; logoSource = candidate.source; logoWidth = valid.width; logoHeight = valid.height; break; }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const sourcePlatform = host === "substack.com" || host.endsWith(".substack.com") ? "substack"
    : host === "medium.com" || host.endsWith(".medium.com") ? "medium"
      : host === "x.com" || host === "twitter.com" ? "x"
        : host === "linkedin.com" || host.endsWith(".linkedin.com") ? "linkedin"
          : host === "beehiiv.com" || host.endsWith(".beehiiv.com") ? "beehiiv" : "independent";
  return { ...normalized, title, description, logoUrl, logoSource, logoWidth, logoHeight, sourcePlatform, metadataStatus: "ready" as const };
}
