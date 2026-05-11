export type NativePermissionKind = "camera" | "photoLibrary" | "microphone";

type PermissionLike = {
  granted?: boolean;
  status?: string;
} | null | undefined;

export function permissionWasGranted(permission: PermissionLike): boolean {
  return permission?.granted === true || permission?.status === "granted";
}

export function nativePermissionDeniedMessage(kind: NativePermissionKind): string {
  switch (kind) {
    case "camera":
      return "Allow camera access in your device settings to scan documents.";
    case "photoLibrary":
      return "Allow photo library access in your device settings.";
    case "microphone":
      return "Allow microphone access in your device settings to record voice notes.";
  }
}

export function nativePermissionErrorMessage(kind: NativePermissionKind): string {
  switch (kind) {
    case "camera":
      return "Could not request camera access. Check device settings and try again.";
    case "photoLibrary":
      return "Could not request photo library access. Check device settings and try again.";
    case "microphone":
      return "Could not request microphone access. Check device settings and try again.";
  }
}
