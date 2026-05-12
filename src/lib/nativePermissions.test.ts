import { describe, expect, it } from "vitest";

import {
  nativeMediaLaunchFailedMessage,
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

  it("returns a clear message when native media launch fails after permission", () => {
    expect(nativeMediaLaunchFailedMessage("camera")).toBe(
      "Could not open the camera. Try again or choose photos from your library."
    );
    expect(nativeMediaLaunchFailedMessage("photoLibrary")).toBe(
      "Could not open the photo library. Try again or use the camera."
    );
  });
});
