"use client";

import { useState } from "react";

export function ReportListingButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 10) {
      setMessage("Please tell us a little more about the issue.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, reason }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "REPORT_UNAVAILABLE");
      setMessage("Thanks — the Letterboard team will review this listing.");
      setReason("");
    } catch {
      setMessage("We couldn’t send the report right now. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="listing-report"><button className="text-button" type="button" onClick={() => { setOpen((value) => !value); setMessage(undefined); }}>Report an unauthorized listing</button>{open ? <form className="listing-report__form" onSubmit={submit}><label htmlFor={`report-reason-${slug}`}>What should we review?</label><textarea id={`report-reason-${slug}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} minLength={10} required placeholder="Tell us why this listing may be unauthorized." /><button className="secondary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>{message ? <p className="form-note" role="status">{message}</p> : null}</form> : null}</div>;
}
