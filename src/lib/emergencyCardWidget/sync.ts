import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";

import { mapCardToPayload, type ThreeByFiveCard } from "./mapping";

const APP_GROUP = "group.com.rivrhealth.app";
const STORAGE_KEY = "emergency_card";
const WIDGET_KIND = "RivrWidget";

let storage: ExtensionStorage | null = null;

function getStorage(): ExtensionStorage | null {
  if (Platform.OS !== "ios") return null;
  try {
    if (!storage) storage = new ExtensionStorage(APP_GROUP);
    return storage;
  } catch {
    // Native module absent (e.g. Expo Go before prebuild) — fail silent.
    return null;
  }
}

/** Write the current emergency card into the shared App Group and refresh the widget. */
export function syncEmergencyCardToWidget(
  card: ThreeByFiveCard | null | undefined,
  updatedAt: string | null | undefined,
): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.set(STORAGE_KEY, JSON.stringify(mapCardToPayload(card, updatedAt)));
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  } catch {
    // Widget sync must never break the app.
  }
}

/** Remove the cached card from the App Group (call on logout) and refresh the widget. */
export function clearEmergencyCardWidget(): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.remove(STORAGE_KEY);
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  } catch {
    // no-op
  }
}
