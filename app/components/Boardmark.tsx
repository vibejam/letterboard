import Image from "next/image";
import type { NewsletterStatus } from "../data/mock";
import { BoardLines, LetterboardMark } from "./Brand";

export type BoardmarkTier = "og" | "legend" | "icon" | "pioneer";
type BoardmarkProps = { status?: NewsletterStatus; tier?: BoardmarkTier; size?: "small" | "medium" | "large" };

const tierLabels: Record<BoardmarkTier, string> = { og: "OG", legend: "Legend", icon: "Icon", pioneer: "Pioneer" };
const tierSources: Record<BoardmarkTier, string> = {
  og: "/brand/boardmarks/boardmark-og.svg",
  legend: "/brand/boardmarks/boardmark-legend.svg",
  icon: "/brand/boardmarks/boardmark-icon.svg",
  pioneer: "/brand/boardmarks/boardmark-pioneer.svg",
};

export function tierForRank(rank: number): BoardmarkTier {
  if (rank <= 5) return "og";
  if (rank <= 10) return "legend";
  if (rank <= 50) return "icon";
  return "pioneer";
}

function PendingBoardmark({ size }: { size: "small" | "medium" | "large" }) {
  return <span className={`boardmark boardmark--${size} boardmark--pending`} aria-label="Letterboard Founding 100 pending Boardmark">
    <span className="boardmark__icon"><LetterboardMark compact /><BoardLines /></span>
    <span className="boardmark__ring" aria-hidden="true" />
    <span>FOUNDING 100 · PENDING</span>
  </span>;
}

export function Boardmark({ status = "confirmed", tier, size = "medium" }: BoardmarkProps) {
  if (status === "pending") return <PendingBoardmark size={size} />;
  if (!tier) return null;
  const label = tierLabels[tier];
  return <span className={`boardmark-art boardmark-art--${size}`} role="img" aria-label={`Letterboard ${label} Boardmark`}>
    <Image src={tierSources[tier]} alt={`${label} Boardmark`} width={320} height={96} unoptimized />
  </span>;
}

export function Avatar({ initials, tone }: { initials: string; tone: string }) {
  return <span className={`avatar avatar--${tone}`}>{initials}</span>;
}
