import { safeExternalUrl } from "./urls.ts";

export type PublicTier = "og" | "legend" | "icon" | "pioneer";
export type SharePlatform = "substack" | "medium" | "x" | "linkedin" | "unknown";

export type ShareDetails = {
  slug: string;
  newsletterName: string;
  foundingPosition: number;
  tier: PublicTier;
  sourcePlatform?: string | null;
  newsletterUrl?: string | null;
  profileUrl: string;
};

export type SharePlan = {
  platform: SharePlatform;
  message: string;
  destination: string | null;
  copyBeforeOpen: boolean;
  toast: string;
  fallback: boolean;
};

const PLATFORM_HOSTS: Record<Exclude<SharePlatform, "unknown">, ReadonlySet<string>> = {
  substack: new Set(["substack.com", "www.substack.com"]),
  medium: new Set(["medium.com", "www.medium.com"]),
  x: new Set(["x.com", "www.x.com"]),
  linkedin: new Set(["linkedin.com", "www.linkedin.com"]),
};

const PUBLIC_TIERS = new Set<PublicTier>(["og", "legend", "icon", "pioneer"]);
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const X_CHARACTER_LIMIT = 280;

function clean(value: string, limit = 180) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function tierLabel(tier: PublicTier) {
  return tier.toUpperCase();
}

export function normalizeSharePlatform(value: string | null | undefined): SharePlatform {
  const normalized = value?.trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (normalized.includes("substack")) return "substack";
  if (normalized.includes("medium")) return "medium";
  if (normalized === "x" || normalized.includes("twitter")) return "x";
  if (normalized.includes("linkedin")) return "linkedin";
  return "unknown";
}

export function inferSharePlatformFromCanonicalUrl(value: string | null | undefined): SharePlatform {
  if (!value) return "unknown";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "unknown";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "substack.com" || host.endsWith(".substack.com")) return "substack";
    if (host === "medium.com" || host.endsWith(".medium.com")) return "medium";
    if (host === "x.com" || host === "twitter.com") return "x";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function publicProfileUrl(slug: string) {
  return SAFE_SLUG.test(slug) ? `https://www.letterboard.lol/${slug}` : null;
}

export function isWhitelistedShareUrl(value: string, platform: Exclude<SharePlatform, "unknown">) {
  try {
    const url = new URL(value);
    const paths: Record<Exclude<SharePlatform, "unknown">, string> = { substack: "/home", medium: "/new-story", x: "/intent/post", linkedin: "/feed/" };
    return url.protocol === "https:" && PLATFORM_HOSTS[platform].has(url.hostname.toLowerCase()) && url.pathname === paths[platform];
  } catch {
    return false;
  }
}

function baseMessage(details: ShareDetails) {
  const name = clean(details.newsletterName);
  const position = `#${Math.max(1, Math.round(details.foundingPosition))}`;
  const tier = tierLabel(details.tier);
  const profile = details.profileUrl;
  const newsletter = safeExternalUrl(details.newsletterUrl);
  return { name, position, tier, profile, newsletter };
}

function substackMessage(details: ShareDetails) {
  const { name, position, tier, profile, newsletter } = baseMessage(details);
  return [
    `I’m sharing ${name} — ${position} ${tier} on Letterboard with a verified Founding Mark.`,
    newsletter ? `Read the newsletter: ${newsletter}` : null,
    `Public profile: ${profile}`,
    "#FoundingMark #Letterboard",
  ].filter(Boolean).join("\n\n");
}

function mediumMessage(details: ShareDetails) {
  const { name, position, tier, profile, newsletter } = baseMessage(details);
  return [
    `${name} is ${position} ${tier} on Letterboard, with a verified Founding Mark.`,
    `Public profile: ${profile}`,
    newsletter ? `Read the newsletter: ${newsletter}` : null,
  ].filter(Boolean).join("\n\n");
}

function xMessage(details: ShareDetails) {
  const { name, position, tier, profile } = baseMessage(details);
  const suffix = ` is ${position} ${tier} on Letterboard with a Founding Mark. ${profile}`;
  return `${name.slice(0, Math.max(1, X_CHARACTER_LIMIT - suffix.length))}${suffix}`.slice(0, X_CHARACTER_LIMIT);
}

function linkedinMessage(details: ShareDetails) {
  const { name, position, tier, profile, newsletter } = baseMessage(details);
  return [
    `Proud to share ${name}: ${position} ${tier} on Letterboard with a verified Founding Mark.`,
    `Public profile: ${profile}`,
    newsletter ? `Read it: ${newsletter}` : null,
  ].filter(Boolean).join("\n\n");
}

function fallbackMessage(details: ShareDetails) {
  const { name, position, tier, profile, newsletter } = baseMessage(details);
  return [
    `${name} is ${position} ${tier} on Letterboard with a verified Founding Mark.`,
    `Public profile: ${profile}`,
    newsletter ? `Newsletter: ${newsletter}` : null,
  ].filter(Boolean).join("\n\n");
}

export function createShareMessage(details: ShareDetails, platform = normalizeSharePlatform(details.sourcePlatform)) {
  if (!PUBLIC_TIERS.has(details.tier)) throw new Error("INVALID_PUBLIC_TIER");
  if (!safeExternalUrl(details.profileUrl)) throw new Error("INVALID_PROFILE_URL");
  if (platform === "substack") return substackMessage(details);
  if (platform === "medium") return mediumMessage(details);
  if (platform === "x") return xMessage(details);
  if (platform === "linkedin") return linkedinMessage(details);
  return fallbackMessage(details);
}

export function buildSharePlan(details: ShareDetails): SharePlan {
  const storedPlatform = normalizeSharePlatform(details.sourcePlatform);
  const platform = storedPlatform === "unknown" ? inferSharePlatformFromCanonicalUrl(details.newsletterUrl) : storedPlatform;
  const profileUrl = safeExternalUrl(details.profileUrl);
  if (!profileUrl) throw new Error("INVALID_PROFILE_URL");
  const normalizedDetails = { ...details, profileUrl };
  const message = createShareMessage(normalizedDetails, platform);

  if (platform === "substack") return { platform, message, destination: "https://substack.com/home", copyBeforeOpen: true, toast: "Your Note is ready — paste it into Substack.", fallback: false };
  if (platform === "medium") return { platform, message, destination: "https://medium.com/new-story", copyBeforeOpen: true, toast: "Your Medium draft is ready — paste the message and publish when ready.", fallback: false };
  if (platform === "x") {
    const destination = new URL("https://x.com/intent/post");
    destination.searchParams.set("text", message);
    destination.searchParams.set("url", profileUrl);
    const intentUrl = destination.toString();
    if (!isWhitelistedShareUrl(intentUrl, "x")) throw new Error("UNSUPPORTED_URL");
    return { platform, message, destination: intentUrl, copyBeforeOpen: false, toast: "Your X composer is ready — review it and click Post.", fallback: false };
  }
  if (platform === "linkedin") return { platform, message, destination: "https://www.linkedin.com/feed/?shareActive=true", copyBeforeOpen: true, toast: "Your LinkedIn post is ready — paste the message into the composer.", fallback: false };

  return { platform, message, destination: safeExternalUrl(details.newsletterUrl), copyBeforeOpen: true, toast: "Your share message is copied.", fallback: true };
}

export const xCharacterLimit = X_CHARACTER_LIMIT;
