export type VerifiedPlatform = "substack" | "medium" | "x" | "linkedin" | "beehiiv" | "independent" | "unknown";

export function inferVerifiedPlatform(stored: string | null | undefined, canonicalUrl: string | null | undefined): VerifiedPlatform {
  const value = stored?.trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (value.includes("substack")) return "substack";
  if (value.includes("medium")) return "medium";
  if (value === "x" || value.includes("twitter")) return "x";
  if (value.includes("linkedin")) return "linkedin";
  if (value.includes("beehiiv")) return "beehiiv";
  if (value === "independent" || value === "custom") return "independent";
  if (!canonicalUrl) return "unknown";
  try {
    const url = new URL(canonicalUrl);
    if (url.protocol !== "https:") return "unknown";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "substack.com" || host.endsWith(".substack.com")) return "substack";
    if (host === "medium.com" || host.endsWith(".medium.com")) return "medium";
    if (host === "x.com" || host === "twitter.com") return "x";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
    if (host === "beehiiv.com" || host.endsWith(".beehiiv.com")) return "beehiiv";
    return "independent";
  } catch {
    return "unknown";
  }
}
