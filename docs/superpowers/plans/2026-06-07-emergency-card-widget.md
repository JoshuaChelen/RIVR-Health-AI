# iOS Emergency Card Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an iOS home-screen widget that displays the user's 3×5 Emergency Card, with detail level chosen by widget size (small=teaser, medium=critical, large=full), tapping through to the in-app card.

**Architecture:** A pure SwiftUI WidgetKit extension (added via `@bacons/apple-targets`) reads a JSON snapshot from a shared App Group (`group.com.rivrhealth.app`). The React Native app writes that snapshot whenever the health profile loads/updates (`ExtensionStorage.set` + `reloadWidget`) and clears it on logout. The widget makes no network calls and deep-links to the existing `rivrhealth://health-summary` route on tap.

**Tech Stack:** Expo SDK 54 / React Native 0.81 (prebuild), TypeScript, Vitest, `@bacons/apple-targets` v4.0.7, SwiftUI / WidgetKit (iOS 15.1 floor), EAS Build.

**Spec:** `docs/superpowers/specs/2026-06-07-ios-emergency-card-widget-design.md`

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `src/lib/emergencyCardWidget/mapping.ts` | Pure `card_json` → widget payload mapping + types (no native imports) | Create |
| `src/lib/emergencyCardWidget/mapping.test.ts` | Vitest unit tests for the mapper | Create |
| `src/lib/emergencyCardWidget/sync.ts` | iOS-guarded App Group write/clear via `ExtensionStorage` | Create |
| `src/lib/emergencyCardWidget/index.ts` | Barrel exports | Create |
| `src/screens/App/HealthSummaryScreen.tsx` | Call sync after profile load (covers realtime) | Modify |
| `src/screens/App/HomeScreen.tsx` | Call sync after profile load | Modify |
| `src/screens/App/ProfileScreen.tsx` | Clear widget on sign-out + delete-account | Modify |
| `app.json` | Register plugin + App Group entitlement | Modify |
| `targets/widget/expo-target.config.js` | Widget target config (type, iOS floor, App Group, colors) | Create |
| `targets/widget/Info.plist` | Widget extension plist | Create (via scaffold) |
| `targets/widget/EmergencyCardWidget.swift` | Model, TimelineProvider, WidgetBundle, entry view | Create |
| `targets/widget/EmergencyCardViews.swift` | Teaser / Critical / Full SwiftUI views + helpers | Create |
| `package.json` | Pin `@bacons/apple-targets@4.0.7` | Modify (via install) |

---

## Task 1: Install `@bacons/apple-targets` and configure `app.json`

**Files:**
- Modify: `package.json` (via npm)
- Modify: `app.json:34` (plugins) and `app.json:39-41` (ios.entitlements)

- [ ] **Step 1: Install the package pinned to an exact version**

Run:
```bash
npm i -E @bacons/apple-targets@4.0.7
```
Expected: `package.json` gains `"@bacons/apple-targets": "4.0.7"` (no caret).

- [ ] **Step 2: Register the config plugin in `app.json`**

In `app.json`, change the end of the `plugins` array (line 34) from:
```json
      "./plugins/with-ios-fmt-xcode-fix"
    ],
```
to:
```json
      "./plugins/with-ios-fmt-xcode-fix",
      "@bacons/apple-targets"
    ],
```

- [ ] **Step 3: Add the App Group entitlement to the main app**

In `app.json`, change the `ios.entitlements` block (lines 39-41) from:
```json
      "entitlements": {
        "com.apple.developer.healthkit": true
      },
```
to:
```json
      "entitlements": {
        "com.apple.developer.healthkit": true,
        "com.apple.security.application-groups": ["group.com.rivrhealth.app"]
      },
```
(Leave the HealthKit entitlement and `NSHealth*` strings untouched — the app uses HealthKit. Do **not** add HealthKit to the widget target.)

- [ ] **Step 4: Verify the config still parses**

Run:
```bash
npx expo config --type public > /dev/null && echo OK
```
Expected: prints `OK` with no error (the plugin resolves and the manifest evaluates).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "build: add @bacons/apple-targets + App Group entitlement for widget"
```

---

## Task 2: Pure payload mapper (TDD)

**Files:**
- Create: `src/lib/emergencyCardWidget/mapping.ts`
- Test: `src/lib/emergencyCardWidget/mapping.test.ts`

This file has **no** `react-native` / native imports so it runs under Vitest's node environment like the existing `src/lib/*.test.ts` files.

- [ ] **Step 1: Write the failing test**

Create `src/lib/emergencyCardWidget/mapping.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { mapCardToPayload } from "./mapping";

describe("mapCardToPayload", () => {
  it("maps a full card to the widget payload", () => {
    const payload = mapCardToPayload(
      {
        blood_type: "O+",
        major_conditions: ["Type 2 Diabetes"],
        major_surgeries: ["Appendectomy"],
        current_meds: ["Metformin", "Lisinopril"],
        allergies: ["Penicillin", "Nuts"],
        implants_devices: ["Pacemaker"],
        anticoagulants: ["Warfarin"],
        anesthesia_notes: ["Malignant hyperthermia risk"],
        emergency_contact: { name: "Jane", phone: "555-0142" },
        one_line_summary: "Diabetic on anticoagulants.",
      },
      "2026-06-05T12:00:00.000Z",
    );

    expect(payload).toEqual({
      schema_version: 1,
      blood_type: "O+",
      allergies: ["Penicillin", "Nuts"],
      emergency_contact: { name: "Jane", phone: "555-0142" },
      major_conditions: ["Type 2 Diabetes"],
      current_meds: ["Metformin", "Lisinopril"],
      anticoagulants: ["Warfarin"],
      implants_devices: ["Pacemaker"],
      anesthesia_notes: ["Malignant hyperthermia risk"],
      major_surgeries: ["Appendectomy"],
      one_line_summary: "Diabetic on anticoagulants.",
      updated_at: "2026-06-05T12:00:00.000Z",
    });
  });

  it("defaults nulls, missing arrays, and missing contact safely", () => {
    const payload = mapCardToPayload({ blood_type: null }, undefined);
    expect(payload.blood_type).toBeNull();
    expect(payload.allergies).toEqual([]);
    expect(payload.current_meds).toEqual([]);
    expect(payload.emergency_contact).toEqual({ name: null, phone: null });
    expect(payload.one_line_summary).toBe("");
    expect(payload.updated_at).toBeNull();
    expect(payload.schema_version).toBe(1);
  });

  it("drops empty/whitespace strings from arrays", () => {
    const payload = mapCardToPayload(
      { allergies: ["Penicillin", "", "   "] },
      null,
    );
    expect(payload.allergies).toEqual(["Penicillin"]);
  });

  it("returns an empty payload for a null/undefined card", () => {
    const payload = mapCardToPayload(null, null);
    expect(payload.blood_type).toBeNull();
    expect(payload.allergies).toEqual([]);
    expect(payload.one_line_summary).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/lib/emergencyCardWidget/mapping.test.ts
```
Expected: FAIL — cannot resolve `./mapping` / `mapCardToPayload is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/emergencyCardWidget/mapping.ts`:
```ts
// Pure mapping from health_profiles.card_json to the widget payload.
// No react-native / native imports here so it is unit-testable under Vitest.

export interface ThreeByFiveCard {
  blood_type?: string | null;
  major_conditions?: string[] | null;
  major_surgeries?: string[] | null;
  current_meds?: string[] | null;
  allergies?: string[] | null;
  implants_devices?: string[] | null;
  anticoagulants?: string[] | null;
  anesthesia_notes?: string[] | null;
  emergency_contact?: { name?: string | null; phone?: string | null } | null;
  one_line_summary?: string | null;
}

export interface EmergencyCardWidgetPayload {
  schema_version: 1;
  blood_type: string | null;
  allergies: string[];
  emergency_contact: { name: string | null; phone: string | null };
  major_conditions: string[];
  current_meds: string[];
  anticoagulants: string[];
  implants_devices: string[];
  anesthesia_notes: string[];
  major_surgeries: string[];
  one_line_summary: string;
  updated_at: string | null;
}

function cleanArray(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

export function mapCardToPayload(
  card: ThreeByFiveCard | null | undefined,
  updatedAt: string | null | undefined,
): EmergencyCardWidgetPayload {
  return {
    schema_version: 1,
    blood_type: card?.blood_type ?? null,
    allergies: cleanArray(card?.allergies),
    emergency_contact: {
      name: card?.emergency_contact?.name ?? null,
      phone: card?.emergency_contact?.phone ?? null,
    },
    major_conditions: cleanArray(card?.major_conditions),
    current_meds: cleanArray(card?.current_meds),
    anticoagulants: cleanArray(card?.anticoagulants),
    implants_devices: cleanArray(card?.implants_devices),
    anesthesia_notes: cleanArray(card?.anesthesia_notes),
    major_surgeries: cleanArray(card?.major_surgeries),
    one_line_summary: card?.one_line_summary ?? "",
    updated_at: updatedAt ?? null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/lib/emergencyCardWidget/mapping.test.ts
```
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/emergencyCardWidget/mapping.ts src/lib/emergencyCardWidget/mapping.test.ts
git commit -m "feat: add emergency-card widget payload mapper"
```

---

## Task 3: iOS-guarded sync module + barrel

**Files:**
- Create: `src/lib/emergencyCardWidget/sync.ts`
- Create: `src/lib/emergencyCardWidget/index.ts`

No Vitest test (it depends on `react-native` + the native `ExtensionStorage` module). Correctness is enforced by `tsc` and the on-device check in Task 8. All native access is guarded so it never throws in JS.

- [ ] **Step 1: Create `src/lib/emergencyCardWidget/sync.ts`**

```ts
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
```

- [ ] **Step 2: Create the barrel `src/lib/emergencyCardWidget/index.ts`**

```ts
export { syncEmergencyCardToWidget, clearEmergencyCardWidget } from "./sync";
export { mapCardToPayload } from "./mapping";
export type { ThreeByFiveCard, EmergencyCardWidgetPayload } from "./mapping";
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (`ExtensionStorage` types ship with the package installed in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/emergencyCardWidget/sync.ts src/lib/emergencyCardWidget/index.ts
git commit -m "feat: add App Group sync for emergency-card widget"
```

---

## Task 4: Wire sync into profile load + clear on logout

**Files:**
- Modify: `src/screens/App/HealthSummaryScreen.tsx` (import + after load, ~line 101)
- Modify: `src/screens/App/HomeScreen.tsx` (import + after load, ~line 102)
- Modify: `src/screens/App/ProfileScreen.tsx` (import + lines 854, 909)

- [ ] **Step 1: HealthSummaryScreen — add the import**

Add to the import block near the other `src/lib` imports at the top of `src/screens/App/HealthSummaryScreen.tsx`:
```ts
import { syncEmergencyCardToWidget } from "../../lib/emergencyCardWidget";
```

- [ ] **Step 2: HealthSummaryScreen — sync after the profile loads**

In `load()`, change (lines 97-101):
```ts
      setProfile(p);
      setEval(ev?.result ?? null);
      setEvalCreatedAt(ev?.created_at ?? null);
      setLatestDocProcessedAt(latestDoc.data?.processed_at ?? null);
      setUserProfile(up);
```
to:
```ts
      setProfile(p);
      setEval(ev?.result ?? null);
      setEvalCreatedAt(ev?.created_at ?? null);
      setLatestDocProcessedAt(latestDoc.data?.processed_at ?? null);
      setUserProfile(up);
      syncEmergencyCardToWidget(
        p?.card_json ?? ev?.result?.three_by_five_card ?? null,
        p?.updated_at ?? null,
      );
```
(The realtime subscription at lines 113-135 calls `load()`, so widget refresh after a new evaluation is covered automatically.)

- [ ] **Step 3: HomeScreen — add the import**

Add near the other `src/lib` imports at the top of `src/screens/App/HomeScreen.tsx`:
```ts
import { syncEmergencyCardToWidget } from "../../lib/emergencyCardWidget";
```

- [ ] **Step 4: HomeScreen — sync after the profile loads**

In `load()`, change (lines 101-102):
```ts
      setScore(typeof resolvedScore === "number" ? resolvedScore : null);
      setLabel(typeof resolvedLabel === "string" ? resolvedLabel : null);
```
to:
```ts
      setScore(typeof resolvedScore === "number" ? resolvedScore : null);
      setLabel(typeof resolvedLabel === "string" ? resolvedLabel : null);
      syncEmergencyCardToWidget(
        healthProfile?.card_json ?? evalResult?.three_by_five_card ?? null,
        healthProfile?.updated_at ?? null,
      );
```

- [ ] **Step 5: ProfileScreen — add the import**

Add near the other `src/lib` imports at the top of `src/screens/App/ProfileScreen.tsx`:
```ts
import { clearEmergencyCardWidget } from "../../lib/emergencyCardWidget";
```

- [ ] **Step 6: ProfileScreen — clear on sign-out (line 854)**

Change:
```tsx
              onPress={async () => { await supabase.auth.signOut(); }}
```
to:
```tsx
              onPress={async () => { clearEmergencyCardWidget(); await supabase.auth.signOut(); }}
```

- [ ] **Step 7: ProfileScreen — clear on delete-account (line 909)**

Change:
```ts
                          await supabase.auth.signOut();
```
to:
```ts
                          clearEmergencyCardWidget();
                          await supabase.auth.signOut();
```

- [ ] **Step 8: Typecheck + run the full test suite**

Run:
```bash
npx tsc --noEmit && npx vitest run
```
Expected: no type errors; all tests pass (existing suite + the new mapping test).

- [ ] **Step 9: Commit**

```bash
git add src/screens/App/HealthSummaryScreen.tsx src/screens/App/HomeScreen.tsx src/screens/App/ProfileScreen.tsx
git commit -m "feat: sync emergency card to widget on load and clear on logout"
```

---

## Task 5: Scaffold the widget target config

**Files:**
- Create: `targets/widget/expo-target.config.js`
- Create: `targets/widget/Info.plist`

> Note: `npx create-target widget` can scaffold this folder, but it also rewrites `app.json` (already done in Task 1) and may pick a different name. Create the two files explicitly as below to keep `name: "RivrWidget"` consistent with `WIDGET_KIND` in `sync.ts`. The Swift files are added in Tasks 6-7.

- [ ] **Step 1: Create `targets/widget/expo-target.config.js`**

```js
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "RivrWidget",
  deploymentTarget: "15.1",
  colors: {
    $accent: "#1FADA6",
    $widgetBackground: { color: "#FFFFFF", darkColor: "#0D1B2A" },
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
```

- [ ] **Step 2: Create `targets/widget/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundleDisplayName</key>
  <string>Emergency Card</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
```

- [ ] **Step 3: Commit**

```bash
git add targets/widget/expo-target.config.js targets/widget/Info.plist
git commit -m "feat: add RivrWidget target config + Info.plist"
```

---

## Task 6: Widget model, provider, and bundle (Swift)

**Files:**
- Create: `targets/widget/EmergencyCardWidget.swift`

No unit test harness for SwiftUI in this repo; compilation is verified by `expo prebuild` + build in Task 8. Keep to iOS 14/15-safe APIs; `containerBackground` is applied only when available (iOS 17+).

- [ ] **Step 1: Create `targets/widget/EmergencyCardWidget.swift`**

```swift
import WidgetKit
import SwiftUI

let appGroup = "group.com.rivrhealth.app"
let storageKey = "emergency_card"
let widgetDeepLink = URL(string: "rivrhealth://health-summary")

// MARK: - Model (mirrors EmergencyCardWidgetPayload in mapping.ts)

struct EmergencyContact: Codable {
  let name: String?
  let phone: String?
}

struct EmergencyCard: Codable {
  let schema_version: Int?
  let blood_type: String?
  let allergies: [String]?
  let emergency_contact: EmergencyContact?
  let major_conditions: [String]?
  let current_meds: [String]?
  let anticoagulants: [String]?
  let implants_devices: [String]?
  let anesthesia_notes: [String]?
  let major_surgeries: [String]?
  let one_line_summary: String?
  let updated_at: String?
}

func loadEmergencyCard() -> EmergencyCard? {
  guard
    let defaults = UserDefaults(suiteName: appGroup),
    let raw = defaults.string(forKey: storageKey),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(EmergencyCard.self, from: data)
}

// MARK: - Timeline

struct CardEntry: TimelineEntry {
  let date: Date
  let card: EmergencyCard?
}

struct CardProvider: TimelineProvider {
  func placeholder(in context: Context) -> CardEntry {
    CardEntry(date: Date(), card: nil)
  }
  func getSnapshot(in context: Context, completion: @escaping (CardEntry) -> Void) {
    completion(CardEntry(date: Date(), card: loadEmergencyCard()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<CardEntry>) -> Void) {
    // Event-driven: a single entry, refreshed when the app calls reloadWidget().
    completion(Timeline(entries: [CardEntry(date: Date(), card: loadEmergencyCard())], policy: .never))
  }
}

// MARK: - Entry view (routes by size)

struct RivrWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  var entry: CardEntry

  var body: some View {
    Group {
      switch family {
      case .systemSmall: TeaserView(card: entry.card)
      case .systemLarge: FullView(card: entry.card)
      default: CriticalView(card: entry.card)
      }
    }
    .widgetBackground(BrandColor.background)
  }
}

// MARK: - Widget + bundle

struct RivrWidget: Widget {
  let kind = "RivrWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: CardProvider()) { entry in
      RivrWidgetEntryView(entry: entry)
        .widgetURL(widgetDeepLink)
    }
    .configurationDisplayName("Emergency Card")
    .description("Your 3×5 emergency medical card.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct RivrWidgetBundle: WidgetBundle {
  var body: some Widget {
    RivrWidget()
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add targets/widget/EmergencyCardWidget.swift
git commit -m "feat: add RivrWidget model, timeline provider, and bundle"
```

---

## Task 7: Widget SwiftUI views (Teaser / Critical / Full)

**Files:**
- Create: `targets/widget/EmergencyCardViews.swift`

- [ ] **Step 1: Create `targets/widget/EmergencyCardViews.swift`**

```swift
import WidgetKit
import SwiftUI

// MARK: - Brand colors + helpers

enum BrandColor {
  static let teal = Color(hex: 0x1FADA6)
  static let emergency = Color(hex: 0xDC2626)
  static let text = Color(hex: 0x0D1B2A)
  static let muted = Color(hex: 0x64748B)
  static let background = Color("WidgetBackground")
}

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

extension View {
  /// iOS 17 requires containerBackground; earlier versions use a plain background.
  @ViewBuilder
  func widgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      self.containerBackground(color, for: .widget)
    } else {
      self.background(color)
    }
  }
}

private func listOrNone(_ values: [String]?) -> String {
  let cleaned = (values ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
  return cleaned.isEmpty ? "None listed" : cleaned.joined(separator: ", ")
}

private func relativeUpdated(_ iso: String?) -> String {
  guard let iso = iso else { return "" }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let date = formatter.date(from: iso)
    ?? { let f = ISO8601DateFormatter(); return f.date(from: iso) }()
  guard let date = date else { return "" }
  let rel = RelativeDateTimeFormatter()
  rel.unitsStyle = .short
  return "Updated " + rel.localizedString(for: date, relativeTo: Date())
}

// MARK: - Shared header + empty state

private struct WidgetHeader: View {
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "cross.case.fill").foregroundColor(BrandColor.emergency)
      Text("Emergency Card")
        .font(.caption).bold()
        .foregroundColor(BrandColor.text)
    }
  }
}

private struct EmptyState: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      WidgetHeader()
      Spacer()
      Text("Open RIVR to set up your Emergency Card.")
        .font(.caption2)
        .foregroundColor(BrandColor.muted)
      Spacer()
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

private struct Row: View {
  let label: String
  let value: String
  var body: some View {
    HStack(alignment: .top, spacing: 6) {
      Text(label.uppercased())
        .font(.system(size: 9, weight: .bold))
        .foregroundColor(BrandColor.muted)
        .frame(width: 64, alignment: .leading)
      Text(value)
        .font(.system(size: 11))
        .foregroundColor(BrandColor.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lineLimit(2)
    }
  }
}

// MARK: - Small (Teaser) — no PHI

struct TeaserView: View {
  let card: EmergencyCard?
  var body: some View {
    if card == nil {
      EmptyState()
    } else {
      VStack(alignment: .leading, spacing: 6) {
        WidgetHeader()
        Spacer()
        Text("Tap to view").font(.subheadline).bold().foregroundColor(BrandColor.teal)
        if !relativeUpdated(card?.updated_at).isEmpty {
          Text(relativeUpdated(card?.updated_at))
            .font(.system(size: 9)).foregroundColor(BrandColor.muted)
        }
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Medium (Critical) — blood type, allergies, ICE

struct CriticalView: View {
  let card: EmergencyCard?
  var body: some View {
    guard let card = card else { return AnyView(EmptyState()) }
    let contact = [card.emergency_contact?.name, card.emergency_contact?.phone]
      .compactMap { $0 }.joined(separator: "  ")
    return AnyView(
      VStack(alignment: .leading, spacing: 6) {
        WidgetHeader()
        Divider()
        Row(label: "Blood", value: card.blood_type ?? "Unknown")
        Row(label: "Allergies", value: listOrNone(card.allergies))
        Row(label: "ICE", value: contact.isEmpty ? "Not set" : contact)
        Spacer()
        Text(relativeUpdated(card.updated_at)).font(.system(size: 9)).foregroundColor(BrandColor.muted)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    )
  }
}

// MARK: - Large (Full) — everything

struct FullView: View {
  let card: EmergencyCard?
  var body: some View {
    guard let card = card else { return AnyView(EmptyState()) }
    let contact = [card.emergency_contact?.name, card.emergency_contact?.phone]
      .compactMap { $0 }.joined(separator: "  ")
    return AnyView(
      VStack(alignment: .leading, spacing: 4) {
        WidgetHeader()
        Divider()
        Row(label: "Blood", value: card.blood_type ?? "Unknown")
        Row(label: "Allergies", value: listOrNone(card.allergies))
        Row(label: "Meds", value: listOrNone(card.current_meds))
        Row(label: "Conditions", value: listOrNone(card.major_conditions))
        Row(label: "Anticoag.", value: listOrNone(card.anticoagulants))
        Row(label: "Implants", value: listOrNone(card.implants_devices))
        Row(label: "ICE", value: contact.isEmpty ? "Not set" : contact)
        if let summary = card.one_line_summary, !summary.isEmpty {
          Text(summary).font(.system(size: 10)).italic().foregroundColor(BrandColor.muted).lineLimit(2)
        }
        Spacer()
        Text(relativeUpdated(card.updated_at)).font(.system(size: 9)).foregroundColor(BrandColor.muted)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    )
  }
}
```

> Implementer note: `CriticalView`/`FullView` use `guard let card = card else { return AnyView(EmptyState()) }` followed by `return AnyView(...)` — every return path is `AnyView`, which a `some View` body with an early return requires. `TeaserView` uses a plain `@ViewBuilder` `if/else` (no `AnyView` needed). The `BrandColor.background = Color("WidgetBackground")` asset is generated from the `$widgetBackground` key in `expo-target.config.js`; if the generated asset name differs, point it at the generated color set's name.

- [ ] **Step 2: Commit**

```bash
git add targets/widget/EmergencyCardViews.swift
git commit -m "feat: add emergency-card widget SwiftUI views"
```

---

## Task 8: Prebuild, build, and verify on a device/simulator

**Files:** none (build verification)

- [ ] **Step 1: Regenerate the iOS project with the widget target**

Run:
```bash
npx expo prebuild -p ios --clean
```
Expected: completes successfully; the `@bacons/apple-targets` plugin injects the `RivrWidget` extension into `ios/RIVRHealthAI.xcodeproj`. (`ios/` is gitignored/generated; this is the normal flow and the existing fmt Podfile fix re-applies.)

- [ ] **Step 2: Verify the widget target landed with the right settings**

Run:
```bash
grep -R "RivrWidget" ios/*.xcodeproj/project.pbxproj | head
grep -R "IPHONEOS_DEPLOYMENT_TARGET = 15.1" ios/*.xcodeproj/project.pbxproj | head
grep -R "application-groups" ios/.targets 2>/dev/null; grep -R "group.com.rivrhealth.app" ios -l | head
```
Expected: `RivrWidget` target present; deployment target 15.1 appears; the App Group string is present in both the app and the widget entitlements.

- [ ] **Step 3: Build and run (simulator is fine for layout; device for real add-to-home-screen)**

Run:
```bash
npx expo run:ios
```
Expected: app builds and launches with no widget-related compile errors. (If iterating only on Swift, you can also open `ios/RIVRHealthAI.xcworkspace` in Xcode 16+ and build the `RivrWidget` scheme.)

- [ ] **Step 4: Manual verification checklist**

Confirm on the simulator/device:
- [ ] Sign in, open Home (or Health Summary) so the app writes the snapshot.
- [ ] Long-press home screen → `+` → search "RIVR" → the widget shows Small / Medium / Large previews.
- [ ] Add **Small** → shows "Emergency Card / Tap to view" with **no** medical data.
- [ ] Add **Medium** → shows blood type, allergies, ICE.
- [ ] Add **Large** → shows the full card + one-line summary.
- [ ] Tap any widget → app opens to the Health Summary / Emergency Card screen.
- [ ] Run a profile evaluation (or edit profile) → widget content updates after returning to/opening the app.
- [ ] Sign out → widget shows the "Open RIVR to set up…" empty state (data cleared).

- [ ] **Step 5: Commit any prebuild-related config deltas (NOT the generated `ios/` folder)**

Run:
```bash
git status --porcelain
```
If only `targets/`, `app.json`, or `package.json` changed, commit them. `ios/` is gitignored and must not be committed.
```bash
git add -A -- ':!ios' ':!android'
git commit -m "chore: widget prebuild config adjustments" || echo "nothing to commit"
```

---

## Task 9: Final verification + compliance checklist

**Files:** none (verification + handoff notes)

- [ ] **Step 1: Full automated gate**

Run:
```bash
npx tsc --noEmit && npx expo lint && npx vitest run
```
Expected: typecheck clean, lint clean, all tests pass.

- [ ] **Step 2: Confirm no HealthKit leakage into the widget**

Run:
```bash
grep -Rni "healthkit\|NSHealth" targets/ && echo "REVIEW: remove HealthKit refs from widget" || echo "OK: widget has no HealthKit refs"
```
Expected: `OK` — the widget target must not reference HealthKit.

- [ ] **Step 3: Record the non-code compliance to-dos** (owner action, not code)

These are required before App Store submission and are the user's responsibility:
- [ ] Privacy policy lists the widget-displayed health fields (blood type, allergies, meds, conditions, ICE) + uses + retention/deletion.
- [ ] App Store Connect → App Privacy: declare Health & Fitness / Sensitive Info → App Functionality (not tracking/advertising).
- [ ] App Review note (paste into App Review Information → Notes):
  > This app stores the user's own self-entered emergency medical profile (blood type, allergies, medications, conditions, emergency contact) on our backend. The home-screen widget displays ONLY that user's own profile data. The widget does NOT use HealthKit or any protected health API. Health data is never used for advertising or data mining. Privacy policy: <URL>.

- [ ] **Step 4: Build for TestFlight via EAS**

Run:
```bash
eas build --platform ios --profile production
```
Expected: EAS provisions the extra extension bundle id + App Group automatically and produces a build for TestFlight. Verify the widget on a real device from TestFlight.

- [ ] **Step 5: Final commit / branch is ready for PR**

```bash
git log --oneline origin/main..HEAD
```
Expected: the feature commits are present on `feat/emergency-card-widget`, ready to open a PR.

---

## Self-review notes (author)

- **Spec coverage:** widget target (Tasks 5-7), App Group transport (Tasks 1,3), size=detail mapping (Task 7), teaser no-PHI (Task 7 TeaserView), sync on load + realtime (Task 4), clear on logout (Task 4), no-HealthKit-on-widget (Tasks 1,9), deep link via existing route (Task 6 `widgetDeepLink`), empty/stale states (Task 7), compliance (Task 9) — all covered.
- **Deep-link correction:** spec §4.4 updated — no `linking.ts` change; widget uses existing `rivrhealth://health-summary`.
- **Type consistency:** `EmergencyCardWidgetPayload` (TS) ↔ `EmergencyCard` (Swift) field names match 1:1; `WIDGET_KIND = "RivrWidget"` matches `kind`/`name` in the widget + target config; App Group string identical in app.json, target config, `sync.ts`, and Swift.
- **Known non-TDD area:** SwiftUI views have no unit harness in this repo; verified by build + on-device checklist (Task 8), which is the appropriate verification for native UI.
