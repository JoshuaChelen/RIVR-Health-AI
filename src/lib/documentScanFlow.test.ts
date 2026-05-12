import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const uploadFileSource = fs.readFileSync(
  path.resolve(__dirname, "../components/ui/ManageDocuments/UploadFile.tsx"),
  "utf8",
);

function getFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}()`);
  if (start === -1) throw new Error(`${name} not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, i);
  }
  throw new Error(`${name} body not closed`);
}

describe("document scan flow", () => {
  it("opens the scan session before asking for a capture source", () => {
    const body = getFunctionBody(uploadFileSource, "handleStartScan");

    expect(body).toContain("setScanOpen(true)");
    expect(body).not.toContain("takeCameraPhoto");
    expect(body).not.toContain("Platform.OS");
  });

  it("surfaces the native image-library fallback in the scan entry copy", () => {
    expect(uploadFileSource).toContain("Take photos or choose images");
  });
});
