import dns from "node:dns/promises";
import net from "node:net";
import { normalizeNewsletterUrl } from "./urls";

function isPrivate(host: string) {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ip = net.isIP(host);
  if (ip === 4) { const [a, b] = host.split('.').map(Number); return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31); }
  return ip === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd'));
}

export async function resolvePublicMetadata(input: string) {
  const normalized = normalizeNewsletterUrl(input);
  const url = new URL(normalized.canonicalUrl);
  if (isPrivate(url.hostname)) throw new Error('UNSUPPORTED_URL');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivate(address))) throw new Error('UNSUPPORTED_URL');
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(7000), headers: { accept: 'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error('METADATA_UNAVAILABLE');
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) throw new Error('UNSUPPORTED_URL');
  const html = (await response.text()).slice(0, 1_000_000);
  const get = (property: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)`, 'i'))?.[1]?.trim() ?? null;
  const title = get('og:title') ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url.hostname;
  const description = get('og:description') ?? get('description');
  const image = get('og:image');
  return { ...normalized, title, description, logoUrl: image, sourcePlatform: /substack/i.test(html) ? 'substack' : /beehiiv/i.test(html) ? 'beehiiv' : 'independent', metadataStatus: 'ready' as const };
}
