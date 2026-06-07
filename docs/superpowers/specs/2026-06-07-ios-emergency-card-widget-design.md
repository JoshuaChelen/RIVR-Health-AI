# iOS Home-Screen Widget — 3×5 Emergency Card

**Date:** 2026-06-07
**Status:** Design approved (pending written-spec review)
**Scope:** iOS only · home screen only · v1

## 1. Goal

Let a RIVR user add an iOS home-screen widget that displays their **3×5 Emergency Card**
(blood type, allergies, medications, conditions, emergency contact, etc.) so the information
is glanceable to anyone holding the phone — the Apple "Medical ID" model — and so the user can
reach the full card in one tap.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Platform | iOS only (Android is a possible later fast-follow) |
| Surface | Home screen only (Lock Screen widgets are a clean iOS-16+ fast-follow) |
| Content | The 3×5 Emergency Card (`health_profiles.card_json`), not the SHIN score |
| Detail control | **Widget size = detail level** (no iOS-17 `AppIntentConfiguration` on a 15.1 floor) |
| Small (`systemSmall`) | **Teaser, no PHI** — name + "Tap to view" + updated date |
| Medium (`systemMedium`) | Critical fields — blood type, allergies, emergency contact |
| Large (`systemLarge`) | Full card — all fields + one-line summary |
| Tooling | `@bacons/apple-targets` v4.0.7 (pinned exact) |
| Data transport | App Group `group.com.rivrhealth.app` via `ExtensionStorage` (no network in widget) |
| Tap target | `rivrhealth://health-summary` (existing route) → `HealthSummaryScreen` |

## 3. Architecture & data flow

The widget is a **pure SwiftUI WidgetKit extension** — it does **not** embed React Native and
makes **no network calls**. It reads a single JSON snapshot from a shared App Group container.
The RN app writes that snapshot whenever the health profile loads or updates, then asks iOS to
reload the widget timeline.

```
health_profiles.card_json  ──app loads/updates profile──▶  syncEmergencyCardToWidget(cardJson, updatedAt)
   (Supabase)                                                   │  ExtensionStorage.set("emergency_card", json)
                                                                 │  ExtensionStorage.reloadWidget("RivrWidget")
                                                                 ▼
                                              App Group: group.com.rivrhealth.app  (shared UserDefaults)
                                                                 │  UserDefaults(suiteName:).string(forKey:)
                                                                 ▼
                                              SwiftUI widget renders by widgetFamily
                                                                 │  .widgetURL(rivrhealth://health-summary)
                                                                 ▼
                                              tap → React Navigation linking → HealthSummaryScreen
```

Refresh is **event-driven**, not polled: the app writes + calls `reloadWidget()` on each profile
load/update. No `TimelineProvider` polling cadence is required (use a single immediate entry).

## 4. Components & interfaces

### 4.1 Widget target — `targets/widget/` (new, Swift)

Created via `npx create-target widget`. Contents:

- **`expo-target.config.js`** — `type: "widget"`, `name: "RivrWidget"`, `deploymentTarget: "15.1"`
  (the plugin defaults to ~18.0 if omitted — must set explicitly), and mirrors the App Group:
  ```js
  /** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
  module.exports = (config) => ({
    type: "widget",
    name: "RivrWidget",
    deploymentTarget: "15.1",
    colors: {
      $accent: "#1FADA6",                 // brand teal (src/theme/tokens.ts)
      $emergency: "#DC2626",              // danger red for emergency accent
      $widgetBackground: { color: "#FFFFFF", darkColor: "#0D1B2A" },
    },
    entitlements: {
      "com.apple.security.application-groups":
        config.ios.entitlements["com.apple.security.application-groups"],
    },
  });
  ```
- **`Info.plist`** — standard widget extension plist (editable, not overwritten by the plugin).
- **`RivrWidget.swift`** — `@main` `WidgetBundle`; one `Widget` using `StaticConfiguration`;
  `supportedFamilies([.systemSmall, .systemMedium, .systemLarge])`; `TimelineProvider` returning a
  single immediate entry decoded from the App Group; `.widgetURL(URL(string: "rivrhealth://emergency-card"))`.
- **`EmergencyCard.swift`** (model + decode) — `Codable` struct matching the JSON payload; reads
  `UserDefaults(suiteName: "group.com.rivrhealth.app")?.string(forKey: "emergency_card")`,
  JSON-decodes, tolerates missing/empty (→ "not set up" state).
- **Three SwiftUI views** switched on `widgetFamily`: `TeaserView` (small), `CriticalView` (medium),
  `FullView` (large). Keep to iOS 14/15-safe SwiftUI APIs only.

### 4.2 Sync module — `src/lib/emergencyCardWidget.ts` (new, TS)

The single seam between app data and the widget. Keeps the native concern out of screens/data layer.

```ts
// Only runs on iOS; no-ops elsewhere.
export function syncEmergencyCardToWidget(
  cardJson: ThreeByFiveCard | null | undefined,
  updatedAt: string | null | undefined,
): void;            // maps card_json → payload, ExtensionStorage.set(...) + reloadWidget("RivrWidget")

export function clearEmergencyCardWidget(): void;   // ExtensionStorage.remove("emergency_card") + reload
```

- Guard with `Platform.OS === "ios"`.
- Wrap `ExtensionStorage` calls in try/catch (and a dynamic import / availability guard) so a missing
  native module never crashes JS (e.g. in Expo Go / web / tests).
- `mapCardToPayload(cardJson, updatedAt)` is a **pure exported function** for unit testing.

### 4.3 Hook points (existing files — surgical edits)

- `src/screens/App/HealthSummaryScreen.tsx` — call `syncEmergencyCardToWidget(profile?.card_json ?? evaluation?.three_by_five_card, profile?.updated_at)` inside the existing `load()` (after `setProfile`, ~line 97) **and** the realtime `health_profiles` UPDATE subscription (~lines 113–135).
- `src/screens/App/HomeScreen.tsx` — call the same in `load()` after `getHealthProfile` (~lines 72–132).
- **Sign-out path** — call `clearEmergencyCardWidget()` wherever the session is cleared, so one user's PHI is never left in the App Group for the next user. (Locate the existing logout/`supabase.auth.signOut` handler during implementation.)

### 4.4 Deep link — no code change

The widget taps the **existing** route `rivrhealth://health-summary`, which already maps to
`HealthSummaryScreen` (`src/navigation/linking.ts:31`). React Navigation's `config.screens` takes a
single path string per screen, so a second alias would require a custom `getStateFromPath` — avoided
as unnecessary. The scheme (`rivrhealth`), `NavigationContainer linking={appLinking}`, and the route
already exist, so nothing in the JS app needs to change for the tap to work (cold or warm launch).

### 4.5 App config — `app.json`

- Add `"@bacons/apple-targets"` to `expo.plugins`.
- Add App Group entitlement to the main app:
  ```json
  "ios": {
    "entitlements": { "com.apple.security.application-groups": ["group.com.rivrhealth.app"] }
  }
  ```
- **Keep** the existing `com.apple.developer.healthkit` entitlement + `NSHealthShare/UpdateUsageDescription`
  (the app genuinely uses HealthKit). **Do not** add any HealthKit entitlement to the widget target.

## 5. Data contract

Stored as **one JSON string** under key `emergency_card` in the App Group (simplest; Swift decodes once).

```ts
interface EmergencyCardWidgetPayload {
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
  updated_at: string | null;   // ISO8601, for "Updated Nd ago"
}
```

Mapping is 1:1 from `three_by_five_card` (`worker/src/schemas.ts:100–114`). Field → size visibility:

| Field | Small | Medium | Large |
|---|:--:|:--:|:--:|
| (app name + "Tap to view" + updated) | ✓ | ✓ | ✓ |
| blood_type | | ✓ | ✓ |
| allergies | | ✓ | ✓ |
| emergency_contact | | ✓ | ✓ |
| major_conditions, current_meds, anticoagulants, implants_devices, anesthesia_notes, major_surgeries, one_line_summary | | | ✓ |

## 6. Widget UI

- **Small (Teaser):** RIVR mark + "Emergency Card" + "Tap to view" + "Updated Nd ago". No medical data.
- **Medium (Critical):** header row; rows for Blood, Allergies, ICE (name + phone); updated footer.
- **Large (Full):** all card fields as label/value rows (`major_*`/`current_meds`/… joined with ", ",
  "None listed" when empty, blood type "Unknown" when null), one-line summary footer, updated footer.
- Palette: brand teal `#1FADA6`, emergency red `#DC2626` accent, surface white / dark `#0D1B2A`.
- **Empty state** (no `emergency_card` key yet): "Open RIVR to set up your Emergency Card."
- Avatar image is **out of scope** for v1 (would require writing the image into the shared container).

## 7. Privacy & security

- App Group data is sandboxed to the app + its own widget extension (not readable by other apps).
- It is stored unencrypted in the shared container — acceptable for this self-entered profile data and
  necessary for the widget to render; documented here as a deliberate choice.
- **Clear on logout** (`clearEmergencyCardWidget()`), so PHI never persists across users on a shared device.
- The widget renders the user's **own** data only; nothing is fetched or sent from the widget.

## 8. App Store / compliance (verified against current guidelines)

- **Permitted.** Strong precedent: Apple's Medical ID and third-party medical-ID widgets show the same.
- Data comes from **our backend, not HealthKit** → avoids HealthKit's "Protected Unless Open" lock
  restriction, and we must **not** add a HealthKit entitlement/usage string to the widget (a phantom
  HealthKit declaration is itself a rejection trigger).
- Required: privacy policy lists these health fields + uses + retention/deletion (5.1.1(i)); App Privacy
  questionnaire declares Health & Fitness / Sensitive Info → App Functionality; widget contains no ads (2.5.16).
- **App Review note** (draft):
  > This app stores the user's own self-entered emergency medical profile (blood type, allergies,
  > medications, conditions, emergency contact) on our backend. The home-screen widget displays ONLY
  > that user's own profile data. The widget does NOT use HealthKit or any protected health API. Health
  > data is never used for advertising or data mining. Privacy policy: <URL>.
- This is product/compliance guidance, not legal advice (HIPAA/GDPR assessed separately).

## 9. Build & release

1. `npm i -E @bacons/apple-targets@4.0.7`
2. `npx create-target widget` (or hand-create `targets/widget/`), register the plugin in `app.json`.
3. Implement SwiftUI + the TS sync module + edits above.
4. `npx expo prebuild -p ios --clean` — **safe**: `ios/`/`android/` are gitignored & generated; the
   existing `with-ios-fmt-xcode-fix` plugin re-applies automatically. Verify the widget target's
   deployment target = 15.1 and `supportedFamilies` after prebuild.
5. EAS build (managed credentials provision the extra extension bundle id + App Group automatically) → TestFlight.
- Local dev requires Xcode 16+/macOS 15+ for SwiftUI previews; EAS SDK-54 builds use Xcode 26.

## 10. Success criteria

- `npx tsc --noEmit` clean; `expo lint` clean.
- Vitest: `mapCardToPayload` unit test (null blood type, empty arrays, missing contact). The existing
  `linking.test.ts` already covers `health-summary` → `HealthSummary`; no new linking test needed.
- On device (TestFlight): widget appears in the gallery in all three sizes; each renders correctly;
  tapping opens the full Emergency Card; data refreshes after running an evaluation; teaser shows no PHI;
  widget clears after logout.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `@bacons/apple-targets` is community-maintained; `@bacons/xcode` dep is alpha | Pin exact `4.0.7`; the widget path is its most-exercised flow; keep widget pure-Swift |
| App Group string mismatch silently yields nil data | Single source `group.com.rivrhealth.app` reused in app.json, target config, JS, Swift |
| `prebuild --clean` regenerates native projects | Native folders are generated (untracked); fmt fix is a plugin; verify target after prebuild |
| Profile changes while app backgrounded → stale widget | Acceptable for v1; refreshes on next app open; "Updated Nd ago" makes staleness visible |
| Native module absent in Expo Go / web / tests | Platform + try/catch guards; `mapCardToPayload` is pure and testable without native |

## 12. Out of scope (v1)

Android widget · Lock Screen widgets (iOS-16+ accessory families) · avatar image · size-independent
explicit detail picker (`IntentConfiguration`) · background/timeline polling.
