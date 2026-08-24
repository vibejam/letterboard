"use client";

import { useState } from "react";

export function ShareProfileButton({ slug }: { slug: string }) {
  const [label, setLabel] = useState("Share profile →");
  async function share() {
    const url = `${window.location.origin}/${slug}`;
    if (navigator.share) await navigator.share({ title: "Letterboard Founding Mark", url });
    else if (navigator.clipboard) await navigator.clipboard.writeText(url);
    setLabel("Profile link copied ✓");
  }
  return <button className="secondary-button" type="button" onClick={share}>{label}</button>;
}
