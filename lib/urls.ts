const tracking = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/i;

export function normalizeNewsletterUrl(input: string) {
  const value = input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('UNSUPPORTED_URL');
  url.hash = '';
  [...url.searchParams.keys()].forEach((key) => tracking.test(key) && url.searchParams.delete(key));
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return { canonicalUrl: `${url.protocol}//${host}${path}${url.search}`, normalizedUrl: `${host}${path}${url.search}` };
}

export function safeSlug(title: string, normalizedUrl: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
  return base || normalizedUrl.split('/')[0].replace(/[^a-z0-9]+/g, '-');
}
