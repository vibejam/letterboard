import { safeExternalUrl } from "./urls.ts";

export type PublicTier = "og" | "legend" | "icon" | "pioneer";
export type SharePlatform = "substack" | "medium" | "x" | "linkedin" | "unknown" | "copy" | "share";
type NativeSharePlatform = "substack" | "medium" | "x" | "linkedin";

export type ShareDetails = {
  slug: string;
  newsletterName: string;
  foundingPosition?: number | null;
  tier?: PublicTier | null;
  sourcePlatform?: string | null;
  newsletterUrl?: string | null;
  profileUrl: string;
  claimState?: "confirmed" | "pending_review";
};

export type SharePlan = {
  platform: SharePlatform;
  message: string;
  destination: string | null;
  copyBeforeOpen: boolean;
  toast: string;
  fallback: boolean;
  shareUrl: string;
  copyText?: string;
};

const PLATFORM_HOSTS: Record<NativeSharePlatform, ReadonlySet<string>> = {
  substack: new Set(["substack.com", "www.substack.com"]),
  medium: new Set(["medium.com", "www.medium.com"]),
  x: new Set(["x.com", "www.x.com"]),
  linkedin: new Set(["linkedin.com", "www.linkedin.com"]),
};

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const X_CHARACTER_LIMIT = 280;

function clean(value: string, limit = 180) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
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

export function isWhitelistedShareUrl(value: string, platform: NativeSharePlatform) {
  try {
    const url = new URL(value);
    const paths: Record<NativeSharePlatform, string> = { substack: "/home", medium: "/new-story", x: "/intent/post", linkedin: "/feed/" };
    return url.protocol === "https:" && PLATFORM_HOSTS[platform].has(url.hostname.toLowerCase()) && url.pathname === paths[platform];
  } catch {
    return false;
  }
}

function baseMessage(details: ShareDetails) {
  return { name: clean(details.newsletterName), profile: details.profileUrl };
}

function xMessage(details: ShareDetails) {
  const { name, profile } = baseMessage(details);
  const prefix = "Locked in my spot in Letterboard's Founding 100 — ";
  const suffix = " is officially one of the first 100 in.";
  const availableNameLength = Math.max(1, X_CHARACTER_LIMIT - prefix.length - suffix.length - profile.length - 2);
  return `${prefix}${name.slice(0, availableNameLength)}${suffix}\n\n${profile}`;
}

function exactMessage(details: ShareDetails, platform: SharePlatform) {
  const { name, profile } = baseMessage(details);
  if (platform === "x") return xMessage(details);
  if (platform === "linkedin") return `Proud to share that ${name} has secured a place in Letterboard's Founding 100 — a small, curated first cohort on a new directory for independent newsletters. Good feeling to have the work recognized this early.\n\n${profile}`;
  if (platform === "substack") return `${name} just claimed a spot in Letterboard's Founding 100 🎉 First 100 in, no more after that. Come take a look —\n\n${profile}`;
  if (platform === "medium") return `${name} has been selected into Letterboard's Founding 100 — the first wave of creators building out a new home for independent newsletters. Excited to be this early.\n\n${profile}`;
  return `${name} — Founding 100, Letterboard.\n\n${profile}`;
}

export function createShareMessage(details: ShareDetails, platform = normalizeSharePlatform(details.sourcePlatform)) {
  if (!safeExternalUrl(details.profileUrl)) throw new Error("INVALID_PROFILE_URL");
  return exactMessage(details, platform);
}

export function buildSharePlan(details: ShareDetails, selectedPlatform?: SharePlatform): SharePlan {
  const storedPlatform = normalizeSharePlatform(details.sourcePlatform);
  const inferredPlatform = storedPlatform === "unknown" ? inferSharePlatformFromCanonicalUrl(details.newsletterUrl) : storedPlatform;
  const platform = selectedPlatform ?? inferredPlatform;
  const profileUrl = safeExternalUrl(details.profileUrl);
  if (!profileUrl) throw new Error("INVALID_PROFILE_URL");
  const message = createShareMessage({ ...details, profileUrl }, platform);

  if (platform === "copy") return { platform, message, destination: null, copyBeforeOpen: true, toast: "Your share message is copied.", fallback: false, shareUrl: profileUrl, copyText: message };
  if (platform === "share") return { platform, message, destination: null, copyBeforeOpen: true, toast: "Choose an app from your share sheet.", fallback: false, shareUrl: profileUrl };
  if (platform === "substack") return { platform, message, destination: "https://substack.com/home", copyBeforeOpen: true, toast: "Your Note is copied — paste it into Substack and post when ready.", fallback: false, shareUrl: profileUrl };
  if (platform === "medium") return { platform, message, destination: "https://medium.com/new-story", copyBeforeOpen: true, toast: "Your Medium message is copied — paste it into your draft and publish when ready.", fallback: false, shareUrl: profileUrl };
  if (platform === "x") {
    const destination = new URL("https://x.com/intent/post");
    destination.searchParams.set("text", message);
    const intentUrl = destination.toString();
    if (!isWhitelistedShareUrl(intentUrl, "x")) throw new Error("UNSUPPORTED_URL");
    return { platform, message, destination: intentUrl, copyBeforeOpen: false, toast: "Your X composer is ready — review it and click Post.", fallback: false, shareUrl: profileUrl };
  }
  if (platform === "linkedin") return { platform, message, destination: "https://www.linkedin.com/feed/?shareActive=true", copyBeforeOpen: true, toast: "Your LinkedIn message is copied — paste the message into your post.", fallback: false, shareUrl: profileUrl };
  return { platform, message, destination: safeExternalUrl(details.newsletterUrl), copyBeforeOpen: true, toast: "Your share message is copied.", fallback: true, shareUrl: profileUrl };
}

export const xCharacterLimit = X_CHARACTER_LIMIT;
