import { describe, expect, it } from "vitest";

import { buildShareLinkMessage } from "./share";

describe("share helpers", () => {
  it("builds a native share payload for a secure health link", () => {
    expect(buildShareLinkMessage("https://example.com/secure-link")).toEqual({
      title:   "RIVR Health secure link",
      message: "RIVR Health secure link:\nhttps://example.com/secure-link",
      url:     "https://example.com/secure-link",
    });
  });
});
