export type LetterboardEvent = "board_viewed" | "claim_started" | "url_submitted" | "metadata_loaded" | "metadata_failed" | "claim_created" | "ownership_email_sent" | "ownership_confirmed" | "profile_viewed" | "newsletter_external_click" | "share_card_opened" | "share_message_copied" | "share_intent_clicked" | "share_clicked" | "share_started" | "share_platform_selected" | "share_link_copied" | "share_composer_opened" | "composer_opened" | "message_copied" | "fallback_used" | "top3_profile_clicked" | "claim_flow_error";

export function capture(event: LetterboardEvent, properties: Record<string, unknown> = {}) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
  if (!key || typeof window === "undefined") return;
  void fetch(`${host}/capture/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, event, properties: { ...properties, $lib: "letterboard-web" }, distinct_id: getDistinctId() }) }).catch(() => undefined);
}

function getDistinctId() {
  const key = "letterboard_distinct_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(key, id);
  return id;
}
