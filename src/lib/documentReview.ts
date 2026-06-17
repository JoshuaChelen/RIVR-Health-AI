// Maps a backend contribution state to user-facing badge text + tone.
export type ContributionState = "unreviewed" | "confirmed" | "edited" | "rejected" | "not_added" | "present";

export type Badge = { label: string; tone: "neutral" | "ok" | "warn" | "muted" };

export function badgeForState(state: ContributionState, origin: "ai" | "manual"): Badge {
  if (origin === "manual") return { label: "From your profile", tone: "muted" };
  switch (state) {
    case "confirmed": return { label: "Confirmed", tone: "ok" };
    case "edited":    return { label: "Edited", tone: "ok" };
    case "rejected":  return { label: "Rejected", tone: "warn" };
    case "not_added": return { label: "Not added", tone: "muted" };
    default:          return { label: "Needs review", tone: "neutral" };
  }
}

// Whether per-item Confirm/Edit/Reject actions apply to this contribution.
export function isActionable(state: ContributionState, origin: "ai" | "manual"): boolean {
  return origin === "ai" && (state === "unreviewed" || state === "confirmed" || state === "edited");
}
