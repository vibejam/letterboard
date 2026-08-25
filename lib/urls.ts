const tracking = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/i;

export function normalizeNewsletterUrl(input: string) {
  const value = input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('UNSUPPORTED_URL');
  url.hash = '';
  [...url.searchParams.keys()].forEach((key) => tracking.test(key) && url.searchParams.delete(key));
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const isSubstack = host.endsWith('.substack.com') || host === 'substack.com';
  const isBeehiiv = host.endsWith('.beehiiv.com');
  const path = (isSubstack || isBeehiiv)
    ? '/'
    : url.pathname.replace(/\/+$/, '') || '/';
  const query = isSubstack || isBeehiiv ? '' : url.search;
  return { canonicalUrl: `https://${host}${path}${query}`, normalizedUrl: `${host}${path}${query}` };
}

export function safeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeRedirectUrl(value: string | null | undefined) {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    const host = url.hostname.toLowerCase();
    if (url.username || url.password || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "127.0.0.1" || host === "::1" || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safeSlug(title: string, normalizedUrl: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
  return base || normalizedUrl.split('/')[0].replace(/[^a-z0-9]+/g, '-');
}
