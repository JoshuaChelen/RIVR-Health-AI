# Android Health Integration Plan — Samsung Health via Health Connect

> Implementation plan for reading on-device health data on Android, as the
> counterpart to the existing Apple HealthKit integration on iOS. Status:
> **plan only — not yet implemented.**

## 1. Goal & scope

Give Android users the same home-screen vitals and timeline sync that iOS users
get from Apple Health: heart rate, sleep, steps, distance, active energy, HRV,
weight, blood pressure, plus 7-day trend charts. **Read-only** (matching the iOS
side, which only reads).

## 2. Key decision: Health Connect — not the Samsung Health SDK

**Recommendation: integrate Google/Android *Health Connect*, not the Samsung
Health SDK directly.**

| | Health Connect (recommended) | Samsung Health Data SDK (direct) |
|---|---|---|
| What it is | Android's system-level health datastore (the real HealthKit analog) | Samsung-proprietary SDK |
| Samsung Health data | ✅ Samsung Health **syncs into** Health Connect, so you read it from there | ✅ direct |
| Device coverage | All Android (Samsung, Pixel, etc.) + many source apps (Fitbit, Google Fit…) | **Samsung devices only** |
| Approval | None for read at runtime; Play Store declaration only when published | **Requires Samsung partner approval / allowlist** |
| React Native support | `react-native-health-connect` (Expo config plugin) | None — you'd hand-write a native module |
| Maintenance | Official, first-party, growing | Niche, Samsung-bound |

The user-facing feature is still "Samsung Health" for Samsung owners — their
Samsung Health data simply arrives **through** Health Connect (the user enables
*Samsung Health → Settings → Health Connect* sync once). Health Connect is
strictly broader and far less friction, so the rest of this plan targets it.

> If a future requirement genuinely needs Samsung-only data that never lands in
> Health Connect, revisit the Samsung Data SDK as a supplementary native module —
> but that is not the path for parity with the current iOS feature.

## 3. How this maps onto the existing architecture

The codebase is already structured to make this clean — minimal churn:

- `src/lib/health/healthkit.ios.ts` — iOS implementation behind a small interface:
  `getHealthAvailability()`, `linkAppleHealth()`, `getAppleHealthSnapshot()`,
  returning the `AppleHealthSnapshot` shape.
- `src/lib/health/healthkitPermissions.ts` — **already platform-agnostic**, pure
  parameterized helpers (unit-tested). Reusable patterns for Android.
- `src/context/AppleHealthContext.tsx` — provider/state machine
  (`status`, `snapshot`, link/unlink), guarded by `Platform.OS === "ios"`.
- `src/screens/App/HomeScreen.tsx` — consumes `useAppleHealth()`, renders
  `AppleHealthMiniCard`, navigates to the `AppleHealth` screen.

### Plan: add an Android sibling behind the same interface

1. **Create `src/lib/health/healthConnect.android.ts`** exporting the *same*
   function names as `healthkit.ios.ts` (`getHealthAvailability`,
   `linkAppleHealth`, `getAppleHealthSnapshot`) returning the same
   `AppleHealthSnapshot` type — or rename the trio to neutral names
   (`getHealthAvailability`, `linkHealth`, `getHealthSnapshot`) in both files.
2. **Switch the import to platform resolution.** Today `AppleHealthContext`
   imports `"../lib/health/healthkit.ios"` (explicit). Rename files to a shared
   base — `health.ios.ts`, `health.android.ts`, `health.ts` (web/fallback
   returning "unavailable") — and import `"../lib/health/health"`. Metro then
   picks the right file per platform; the context drops its `Platform.OS` gate
   and just works on both.
3. **Generalize the context** (`AppleHealthContext` → `HealthContext`,
   `useAppleHealth` → `useHealth`) OR keep the names and only relabel the UI.
   Recommend the rename for clarity; it's mechanical.
4. **Conditional labels:** "Apple Health" on iOS, "Samsung Health / Health
   Connect" on Android (the mini-card title, the link screen copy, settings row).

## 4. Library & native setup

- **Library:** `react-native-health-connect` (Expo config plugin included).
- **`app.json` plugins:** add `react-native-health-connect` plugin (it injects
  the Health Connect `<queries>`, permissions, and the required
  `PermissionsRationaleActivity` intent-filter into `AndroidManifest.xml`).
- **minSdk:** Health Connect requires **API 26+**. Bump via the existing
  `expo-build-properties` plugin: `android.minSdkVersion: 26` (Expo SDK 54
  defaults to 24). compileSdk/targetSdk 35 already satisfy HC.
- **Privacy policy:** Health Connect *requires* a privacy-policy screen reachable
  from the permissions-rationale intent. A policy already exists (linked in
  `ProfileScreen`) — supply its URL to the rationale activity / a small
  in-app rationale screen.
- **Permissions (manifest):** declare read permissions per data type, e.g.
  `android.permission.health.READ_HEART_RATE`, `READ_STEPS`, `READ_SLEEP`,
  `READ_DISTANCE`, `READ_ACTIVE_CALORIES_BURNED`,
  `READ_HEART_RATE_VARIABILITY`, `READ_WEIGHT`, `READ_BLOOD_PRESSURE`.
- **Native dirs:** `android/` is committed, so regenerate with
  `npx expo prebuild -p android` after adding the plugin (or let EAS prebuild).

## 5. Data mapping: snapshot fields → Health Connect records

The iOS `AppleHealthSnapshot` maps almost 1:1 to Health Connect record types:

| Snapshot field | Health Connect record / API |
|---|---|
| `heartRate`, `heartRateTrend` | `HeartRateRecord` (read latest / samples) |
| `sleepAvgMin`, `sleepTrend7d` | `SleepSessionRecord` (sum stage durations) |
| `stepsAvg7d`, `stepsTrend7d` | `StepsRecord` — use `aggregateGroupByDuration` (daily buckets) |
| `walkingRunningDistanceAvg7dMiles` | `DistanceRecord` (meters → miles) |
| `activeEnergyAvg7dKcal` | `ActiveCaloriesBurnedRecord` (kcal) |
| `hrvMsRecent` | `HeartRateVariabilityRmssdRecord` ⚠️ RMSSD, **not** SDNN like iOS — note the semantic difference in the UI/label |
| `weightLbRecent` | `WeightRecord` (kg/grams → lb) |
| `bloodPressureRecent` | `BloodPressureRecord` (systolic/diastolic) |

Prefer Health Connect's `aggregate` / `aggregateGroupByDuration` for steps,
distance, and calories (cleaner than manually summing raw records).

## 6. Permission & availability flow (mirrors `getHealthAvailability`)

1. `getSdkStatus()` → `SDK_AVAILABLE` / `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED`
   / unavailable. On Android < 14, Health Connect is a separate Play Store app;
   if not installed, deep-link the user to install it.
2. `initialize()` the client.
3. `requestPermission([...read perms])` → system Health Connect consent UI.
4. `readRecords` / `aggregate` per type → build the snapshot.
5. Map the result to the same `status` states the iOS context already uses
   (`loading` / `unavailable` / `needs-permission` / `linked` / `error`).

## 7. UI changes

- `AppleHealthMiniCard` → conditional title/icon ("Samsung Health" / "Health
  Connect" on Android). Logic unchanged — it just renders the shared snapshot.
- The `AppleHealth` screen → relabel; charts/data already generic.
- The **iOS widget** (`AddWidgetCard`, WidgetKit) stays iOS-only. An Android
  home-screen widget is a *separate, later* effort (Glance/AppWidget) — out of
  scope here.

## 8. Backend changes (minimal)

- `linkHealth` / `unlinkHealth` already exist (`src/lib/api/data.ts`). Optionally
  add a `source` value (`"health_connect"` vs `"apple_health"`) on the profile so
  the server knows provenance; otherwise no schema change.
- `syncAppleHealthToTimeline` is source-agnostic at heart — generalize the name
  and let it accept the snapshot regardless of platform.

## 9. Build / distribution / Play Store

- **Now (internal APK / sideload):** no Play Store gating — the Health Connect
  permissions work at runtime once declared. Good for immediate testing.
- **When publishing to Play Store:** Google requires a **Health Connect data
  declaration form** + privacy policy + (often) a review justifying each data
  type. Budget time for this before a public release.

## 10. Testing strategy

- **Use a real Android device** — ideally a Samsung phone with Samsung Health
  installed and *Health Connect sync enabled* in Samsung Health settings.
  Emulators have limited Health Connect support and no real Samsung data.
- Verify: install HC (if Android 13), grant permissions, confirm each metric
  populates, and that denying permission lands in the `needs-permission` state.
- Add unit tests for the Android record→snapshot mappers, mirroring the existing
  `healthkitPermissions.test.ts` pattern (pure functions, no native calls).

## 11. Phased milestones

1. **Native enablement** — add library + config plugin, bump minSdk to 26,
   prebuild, confirm a clean EAS Android build.
2. **Availability + permissions** — SDK status, install deep-link, permission
   request, wired into the shared `status` machine.
3. **Data read + mapping** — implement `health.android.ts` snapshot (start with
   steps/heart-rate/sleep, then distance/energy/HRV/weight/BP).
4. **Context + UI generalization** — platform-resolved import, relabel cards/
   screen, timeline sync.
5. **Test on a Samsung device**, add mapper unit tests, polish empty/denied
   states.

_Rough effort: ~2–4 focused days, dominated by step 3 (data mapping) and
on-device testing in step 5._

## 12. Risks & caveats

- **Samsung→HC sync is user-enabled.** If a user hasn't turned on Health Connect
  sync inside Samsung Health, their data won't appear — surface a helpful hint.
- **HRV semantics differ** (RMSSD vs iOS SDNN) — don't present them as identical.
- **Unit conversions** (kg→lb, m→mi) must match the iOS formatting.
- **Health Connect availability** varies by Android version — handle the
  not-installed / update-required paths explicitly.
- **`react-native-health-connect` requires a dev/preview build** (not Expo Go) —
  already true for this app.
- **Play Store review** for Health Connect access is a real gate for public
  release (not for the current internal APK).
