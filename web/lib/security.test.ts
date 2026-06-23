import { describe, expect, it } from "vitest";
import { enforceHttps, validateUrlToken, validateUrlUid } from "./security";

describe("enforceHttps", () => {
  it("does not throw for any URL in dev mode", () => {
    expect(() => enforceHttps("http://api.example.com", true)).not.toThrow();
    expect(() => enforceHttps("http://localhost:8000", true)).not.toThrow();
    expect(() => enforceHttps("https://api.example.com", true)).not.toThrow();
  });

  it("allows https:// in production", () => {
    expect(() => enforceHttps("https://api.rivr.com", false)).not.toThrow();
  });

  it("allows http://localhost in production (for local testing containers)", () => {
    expect(() => enforceHttps("http://localhost:8000", false)).not.toThrow();
    expect(() => enforceHttps("http://127.0.0.1:8000", false)).not.toThrow();
  });

  it("throws for plain HTTP in production", () => {
    expect(() => enforceHttps("http://api.rivr.com", false)).toThrow(/HTTPS/);
    expect(() => enforceHttps("http://192.168.1.1:8000", false)).toThrow(/HTTPS/);
  });
});

describe("validateUrlToken", () => {
  it("accepts valid base64url tokens (20–500 chars)", () => {
    expect(validateUrlToken("abcdefghij0123456789")).toBe(true);
    expect(validateUrlToken("A".repeat(500))).toBe(true);
    expect(validateUrlToken("abc-_ABC123abc-_ABC1")).toBe(true);
    // Django signed email-verify token: data:timestamp:signature (colons allowed)
    expect(validateUrlToken("ImMwZmZlZQ:1wbzMa:5-JXFrIW_upwjDyYl_ohzbEH4kXt8Ze0")).toBe(true);
  });

  it("rejects null, undefined, and empty string", () => {
    expect(validateUrlToken(null)).toBe(false);
    expect(validateUrlToken(undefined)).toBe(false);
    expect(validateUrlToken("")).toBe(false);
  });

  it("rejects tokens that are too short or contain invalid characters", () => {
    expect(validateUrlToken("short")).toBe(false);
    expect(validateUrlToken("<script>alert(1)</script>")).toBe(false);
    expect(validateUrlToken("token with spaces")).toBe(false);
    expect(validateUrlToken("A".repeat(501))).toBe(false);
  });
});

describe("validateUrlUid", () => {
  it("accepts numeric IDs and UUID-style strings", () => {
    expect(validateUrlUid("12345")).toBe(true);
    expect(validateUrlUid("a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8")).toBe(true);
    // Real Django reset uid: urlsafe-base64 of the user's UUID pk
    expect(validateUrlUid("ODI1ODZkZDYtMjhmMC00MWE1LWJhZjEtOTJhMDUzMzRlMmFi")).toBe(true);
  });

  it("rejects null, undefined, and empty string", () => {
    expect(validateUrlUid(null)).toBe(false);
    expect(validateUrlUid(undefined)).toBe(false);
    expect(validateUrlUid("")).toBe(false);
  });

  it("rejects UIDs with invalid characters", () => {
    expect(validateUrlUid("uid<script>")).toBe(false);
    expect(validateUrlUid("user name")).toBe(false);
    expect(validateUrlUid("a".repeat(100))).toBe(false);
  });
});
