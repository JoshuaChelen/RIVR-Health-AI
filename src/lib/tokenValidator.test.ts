import { describe, expect, it } from "vitest";
import { isValidResetToken, validateTokenFormat } from "./tokenValidator";

describe("validateTokenFormat (type=token, default)", () => {
  it("accepts valid base64url tokens (20–500 chars)", () => {
    const valid = [
      "a".repeat(20),
      "abcdefghijk123456789",
      "abc-_ABC-_ABC-_ABC-_",
      "A".repeat(500),
    ];
    for (const t of valid) {
      expect(validateTokenFormat(t), `expected valid: ${t.slice(0, 30)}`).toBe(true);
    }
  });

  it("rejects tokens that are too short or too long", () => {
    expect(validateTokenFormat("short")).toBe(false); // < 20
    expect(validateTokenFormat("a".repeat(501))).toBe(false); // > 500
  });

  it("rejects tokens containing HTML-significant or injection characters", () => {
    const invalid = [
      "valid_token_but_has<bracket>",
      "token\nwith\nnewlines",
      "token with spaces",
      `token"with"quotes`,
      "token<img>",
      "<script>alert(1)</script>",
      "'; DROP TABLE users; --",
      "../../../etc/passwd",
      "javascript:alert(1)",
    ];
    for (const t of invalid) {
      expect(validateTokenFormat(t), `expected invalid: ${t}`).toBe(false);
    }
  });
});

describe("validateTokenFormat (type=uid)", () => {
  it("accepts numeric IDs and UUID-style strings", () => {
    const valid = ["12345", "999999999", "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8"];
    for (const uid of valid) {
      expect(validateTokenFormat(uid, "uid"), `expected valid uid: ${uid}`).toBe(true);
    }
  });

  it("rejects malformed UIDs", () => {
    const invalid = [
      "not-a-uid-because-it-has-invalid",
      "uid<script>",
      "",
      " 123",
      "a".repeat(100), // too long
    ];
    for (const uid of invalid) {
      expect(validateTokenFormat(uid, "uid"), `expected invalid uid: ${uid}`).toBe(false);
    }
  });
});

describe("isValidResetToken", () => {
  it("returns true for a valid uid + token pair", () => {
    expect(isValidResetToken("12345", "abcdefghijk123456789")).toBe(true);
  });

  it("returns false if either value is null, undefined, or invalid", () => {
    expect(isValidResetToken(null, "abcdefghijk123456789")).toBe(false);
    expect(isValidResetToken("12345", null)).toBe(false);
    expect(isValidResetToken("bad<uid>", "abcdefghijk123456789")).toBe(false);
    expect(isValidResetToken("12345", "short")).toBe(false);
  });
});
