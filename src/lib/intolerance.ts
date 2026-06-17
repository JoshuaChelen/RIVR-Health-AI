// Builds the secondary line for an allergy row, labeling intolerances.
export function allergySecondaryLabel(
  reaction?: string,
  severity?: string,
  type?: "allergy" | "intolerance",
): string {
  return [reaction, severity, type === "intolerance" ? "Intolerance" : null]
    .filter((p) => p && String(p).trim())
    .join(" · ");
}
