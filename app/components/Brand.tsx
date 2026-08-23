type BrandProps = { compact?: boolean };

export function LetterboardMark({ compact = false }: BrandProps) {
  return (
    <svg aria-hidden="true" className={compact ? "brand-mark brand-mark--compact" : "brand-mark"} viewBox="0 0 52 52" role="img">
      <rect x="3" y="3" width="46" height="46" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M17 15v22h18" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="square" />
    </svg>
  );
}

export function BoardLines() {
  return <svg aria-hidden="true" className="board-lines" viewBox="0 0 54 42"><path d="M3 7h27M3 20h38M3 33h21" stroke="currentColor" strokeWidth="4" strokeLinecap="square" /><path d="M44 33h7" stroke="var(--coral)" strokeWidth="4" strokeLinecap="square" /></svg>;
}

export function Wordmark({ compact = false }: BrandProps) {
  return <div className={compact ? "wordmark wordmark--compact" : "wordmark"} aria-label="Letterboard"><LetterboardMark compact={compact} /><span>LETTERBOARD</span></div>;
}
