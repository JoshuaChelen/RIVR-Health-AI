import { describe, expect, it } from "vitest";

import {
  nativePermissionDeniedMessage,
  nativePermissionErrorMessage,
  permissionWasGranted,
} from "./nativePermissions";

describe("native permission helpers", () => {
  it("recognizes granted permission responses", () => {
    expect(permissionWasGranted({ granted: true })).toBe(true);
    expect(permissionWasGranted({ status: "granted" })).toBe(true);
    expect(permissionWasGranted({ granted: false, status: "denied" })).toBe(false);
    expect(permissionWasGranted(null)).toBe(false);
  });

  it("returns release-safe fallback messages for denied permissions", () => {
    expect(nativePermissionDeniedMessage("microphone")).toBe(
      "Allow microphone access in your device settings to record voice notes."
    );
    expect(nativePermissionDeniedMessage("camera")).toBe(
      "Allow camera access in your device settings to scan documents."
    );
    expect(nativePermissionDeniedMessage("photoLibrary")).toBe(
      "Allow photo library access in your device settings."
    );
  });

  it("returns a fallback message when a native permission request throws", () => {
    expect(nativePermissionErrorMessage("microphone")).toBe(
      "Could not request microphone access. Check device settings and try again."
    );
  });
});
