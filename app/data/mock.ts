import type { BoardmarkTier } from "../components/Boardmark";

export type NewsletterStatus = "founding" | "pending" | "confirmed";

export type Newsletter = {
  id: string;
  slug?: string;
  name: string;
  url: string;
  description: string;
  logoUrl?: string;
  category: string;
  bid: number;
  clicks: number;
  lastSeen: string;
  initials: string;
  tone: "ink" | "paper" | "blue" | "lime" | "coral" | "violet";
  status?: NewsletterStatus;
  foundingTier?: BoardmarkTier;
  foundingPosition?: number;
  sourcePlatform?: string | null;
};

export type BoardActivity = { name: string; detail: string; time: string; tone: Newsletter["tone"] };
export type BoardViewData = { stats: { claimed: number; total: number }; leaderboard: Newsletter[]; activity: BoardActivity[] };
export type BoardApiRow = { id: string; slug: string; title: string; description?: string | null; logo_url?: string | null; logo_source?: string | null; canonical_url: string; source_platform?: string | null; founding_position: number | null; founding_tier?: string | null; newsletter_clicks?: number | null; ownership_status: string };
export type BoardApiActivity = { id: number; event_type: string; created_at: string; newsletters?: { title?: string; slug?: string } | { title?: string; slug?: string }[] | null };

const devFixturesEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_FIXTURES === "true";
export const boardStats = devFixturesEnabled ? { online: 126, visitors: 8420, claimed: 37, total: 100 } : { online: 0, visitors: 0, claimed: 0, total: 100 };

const fixtureLeaderboard: Newsletter[] = [
  { id: "daily-signal", name: "The Daily Signal", url: "thedailysignal.co", description: "A sharp daily briefing for people building what comes next.", category: "Technology", bid: 842, clicks: 1204, lastSeen: "8 minutes ago", initials: "T", tone: "ink", status: "founding", foundingTier: "og" },
  { id: "founder-notes", name: "Founder Notes", url: "foundernotes.co", description: "Field notes on building companies with taste and patience.", category: "Business", bid: 631, clicks: 842, lastSeen: "12 minutes ago", initials: "F", tone: "paper", status: "founding", foundingTier: "og" },
  { id: "ai-morning", name: "AI Morning", url: "aimorning.news", description: "The useful AI stories, tools, and ideas worth carrying forward.", category: "Independent", bid: 418, clicks: 516, lastSeen: "18 minutes ago", initials: "A", tone: "blue", status: "founding", foundingTier: "og" },
  { id: "market-memo", name: "Market Memo", url: "marketmemo.email", description: "A clear-eyed read on markets, incentives, and momentum.", category: "Markets", bid: 375, clicks: 412, lastSeen: "24 minutes ago", initials: "M", tone: "violet", status: "founding", foundingTier: "og" },
  { id: "growth-dispatch", name: "Growth Dispatch", url: "growthdispatch.com", description: "Practical experiments for teams that want better growth loops.", category: "Business", bid: 312, clicks: 365, lastSeen: "31 minutes ago", initials: "G", tone: "lime", status: "founding", foundingTier: "og" },
  { id: "product-pulse", name: "Product Pulse", url: "productpulse.news", description: "The products, patterns, and people shaping the next interface.", category: "Technology", bid: 268, clicks: 298, lastSeen: "42 minutes ago", initials: "P", tone: "coral", status: "founding", foundingTier: "legend" },
  { id: "in-focus", name: "In Focus", url: "infocus.letter", description: "Culture and ideas for a more considered internet.", category: "Culture", bid: 221, clicks: 254, lastSeen: "51 minutes ago", initials: "I", tone: "blue", status: "founding", foundingTier: "legend" },
  { id: "strategy-stack", name: "Strategy Stack", url: "strategystack.co", description: "A weekly stack of decisions, frameworks, and useful edges.", category: "Work", bid: 187, clicks: 219, lastSeen: "1 hour ago", initials: "S", tone: "coral", status: "founding", foundingTier: "legend" },
  { id: "workweek-brief", name: "Workweek Brief", url: "workweekbrief.com", description: "The small systems that make ambitious work feel lighter.", category: "Work", bid: 154, clicks: 188, lastSeen: "1 hour ago", initials: "W", tone: "violet", status: "founding", foundingTier: "legend" },
  { id: "operator-journal", name: "Operator Journal", url: "operatorjournal.io", description: "Operating lessons from the people closest to the work.", category: "Operations", bid: 129, clicks: 162, lastSeen: "2 hours ago", initials: "O", tone: "lime", status: "founding", foundingTier: "icon" },
];

const fixtureActivity = [
  { name: "The Daily Signal", detail: "claimed founding place #01", time: "just now", tone: "ink" as const },
  { name: "Founder Notes", detail: "claimed founding place #02", time: "2 minutes ago", tone: "paper" as const },
  { name: "AI Morning", detail: "claimed founding place #03", time: "5 minutes ago", tone: "blue" as const },
  { name: "Market Memo", detail: "claimed founding place #04", time: "11 minutes ago", tone: "violet" as const },
];

export const leaderboard: Newsletter[] = devFixturesEnabled ? fixtureLeaderboard : [];
export const activity = devFixturesEnabled ? fixtureActivity : [];

const liveTones: Newsletter["tone"][] = ["ink", "paper", "blue", "lime", "coral", "violet"];
const liveTiers = new Set<BoardmarkTier>(["og", "legend", "icon", "pioneer"]);

function boardmarkTier(value: string | null | undefined): BoardmarkTier | undefined {
  return value && liveTiers.has(value as BoardmarkTier) ? value as BoardmarkTier : undefined;
}

export function mapBoardRow(row: BoardApiRow, index: number): Newsletter {
  return {
    id: row.id,
    slug: row.slug,
    name: row.title,
    url: row.canonical_url,
    description: row.description ?? "A public newsletter on Letterboard.",
    logoUrl: row.logo_url ?? undefined,
    category: row.source_platform ?? "Newsletter",
    bid: 0,
    clicks: Number(row.newsletter_clicks ?? 0),
    lastSeen: "live",
    initials: row.title.slice(0, 1).toUpperCase(),
    tone: liveTones[index % liveTones.length],
    status: row.ownership_status === "confirmed" ? "confirmed" : "pending",
    foundingTier: boardmarkTier(row.founding_tier),
    foundingPosition: row.founding_position ?? undefined,
    sourcePlatform: row.source_platform,
  };
}

export function mapBoardActivity(event: BoardApiActivity, index: number): BoardActivity {
  const newsletter = Array.isArray(event.newsletters) ? event.newsletters[0] : event.newsletters;
  const name = newsletter?.title ?? "Letterboard";
  return { name, detail: event.event_type, time: new Date(event.created_at).toLocaleString(), tone: liveTones[index % liveTones.length] };
}

export const defaultBoardViewData: BoardViewData = { stats: boardStats, leaderboard, activity };

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatClicks(value: number) {
  return `${formatNumber(value)} ${value === 1 ? "click" : "clicks"}`;
}
