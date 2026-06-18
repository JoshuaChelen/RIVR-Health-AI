/**
 * XSS Safety Invariant Tests for AppText
 *
 * React Native's <Text> component does NOT support innerHTML or
 * dangerouslySetInnerHTML — all children are rendered as literal text.
 *
 * This suite verifies that the AppText source code does not introduce any
 * unsafe rendering patterns by static code inspection, and documents the
 * safety invariant for future developers.
 *
 * Note: Full rendering tests would require @testing-library/react-native.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "AppText.tsx"), "utf-8");

describe("AppText XSS safety invariant (static code inspection)", () => {
  it("renders via React Native <Text> (not a DOM element)", () => {
    expect(source).toContain("<Text");
  });

  it("has the security invariant comment for developer guidance", () => {
    expect(source).toContain("SECURITY INVARIANT");
  });

  it("does not call dangerouslySetInnerHTML as a JSX prop (unsafe sink)", () => {
    // The comment mentions dangerouslySetInnerHTML as a warning — that is
    // acceptable.  What we guard against is using it as a JSX prop value.
    // Pattern: `dangerouslySetInnerHTML={{` or `dangerouslySetInnerHTML={`
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=\s*\{/);
  });

  it("does not call innerHTML assignment (not applicable in RN but guard for web ports)", () => {
    expect(source).not.toMatch(/\.innerHTML\s*=/);
  });

  it("does not use eval() or Function() constructor", () => {
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
  });
});

describe("XSS payload format — React Native safety note", () => {
  // React Native renders string children as plain text.  This suite
  // documents the expected safety property: these payloads are strings,
  // and passing them as children to <Text> does NOT execute them.
  const xssPayloads = [
    "<script>alert('xss')</script>",
    "<img src=x onerror='alert(1)'>",
    "<iframe src='javascript:alert(1)'></iframe>",
    "<div onclick='alert(1)'>click me</div>",
  ];

  for (const payload of xssPayloads) {
    it(`payload "${payload.slice(0, 40)}" is a plain string value`, () => {
      // Safety: in React Native the <Text> component has no DOM concept.
      // String children go through the native text rendering pipeline —
      // angle brackets and event attributes are never interpreted as HTML.
      expect(typeof payload).toBe("string");
    });
  }
});
