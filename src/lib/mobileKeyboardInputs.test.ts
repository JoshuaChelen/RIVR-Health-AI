import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(__dirname, "..");

function collectTsxFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

describe("mobile keyboard inputs", () => {
  it("keeps native TextInput fields configured to show the phone keyboard", () => {
    const missing = collectTsxFiles(SRC_DIR).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      const matches = source.matchAll(/<TextInput(?=[\s/])[\s\S]*?\/>/g);
      return Array.from(matches)
        .filter((match) => !match[0].includes("showSoftInputOnFocus"))
        .map((match) => path.relative(SRC_DIR, filePath));
    });

    expect(missing).toEqual([]);
  });

  it("focuses date entry after timeline date precision controls are tapped", () => {
    const detailsSource = fs.readFileSync(
      path.join(SRC_DIR, "screens/App/TimelineEventDetailsScreen.tsx"),
      "utf8",
    );
    const modalSource = fs.readFileSync(
      path.join(SRC_DIR, "components/ui/Timeline/SetVisitDateModal.tsx"),
      "utf8",
    );

    expect(detailsSource).toContain("dateInputRef.current?.focus()");
    expect(modalSource).toContain("dateInputRef.current?.focus()");
  });
});
