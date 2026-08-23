import type { NewsletterStatus } from "../data/mock";
import { BoardLines, LetterboardMark } from "./Brand";

type BoardmarkProps = { status?: NewsletterStatus; size?: "small" | "medium" | "large"; showLabel?: boolean };

export function Boardmark({ status = "confirmed", size = "medium", showLabel = true }: BoardmarkProps) {
  const pending = status === "pending";
  return <span className={`boardmark boardmark--${size} ${pending ? "boardmark--pending" : ""}`}>
    <span className="boardmark__icon"><LetterboardMark compact /><BoardLines /></span>
    {!pending && <span className="boardmark__dot" aria-hidden="true" />}
    {pending && <span className="boardmark__ring" aria-hidden="true" />}
    {showLabel && <span>{pending ? "FOUNDING 100 · PENDING" : "FOUNDING 100"}</span>}
  </span>;
}

export function Avatar({ initials, tone }: { initials: string; tone: string }) {
  return <span className={`avatar avatar--${tone}`}>{initials}</span>;
}

