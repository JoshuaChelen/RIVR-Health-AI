import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { getHealthProfile, getLatestEvaluation } from "../../lib/aiJobs";
import { getProfile } from "../../lib/profile";
import { getCurrentUserId } from "../../lib/auth";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, radius, shadows, spacing, typescale } from "../../theme/tokens";
import Ionicons from "@expo/vector-icons/Ionicons";

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function safeJoin(arr: any[]) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "";
}

type Props = NativeStackScreenProps<AppStackParamList, "HealthSummary">;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HealthSummaryScreen({ navigation }: Props) {
  const [loading, setLoading]         = useState(true);
  const [profile, setProfile]         = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [evaluation, setEval]         = useState<any>(null);
  const [error, setError]             = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const userId = await getCurrentUserId();
      const [p, ev, up] = await Promise.all([
        getHealthProfile(userId),
        getLatestEvaluation(userId),
        getProfile(userId),
      ]);
      setProfile(p);
      setEval(ev?.result ?? null);
      setUserProfile(up);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load health summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Derived data ────────────────────────────────────────────────────────────
  const summaryJson  = profile?.summary_json ?? null;
  const disclaimer   = summaryJson?.disclaimer ?? evaluation?.disclaimer ?? null;
  const overview     = summaryJson?.overview ?? null;
  const fullSummary  = summaryJson?.full_summary_markdown ?? evaluation?.full_summary_markdown ?? null;
  const card         = profile?.card_json ?? evaluation?.three_by_five_card ?? null;

  const hasContent = !!(fullSummary || card);

  // ── Staleness ───────────────────────────────────────────────────────────────
  const healthUpdatedMs  = profile?.updated_at    ? new Date(profile.updated_at).getTime()    : null;
  const profileUpdatedMs = userProfile?.updated_at ? new Date(userProfile.updated_at).getTime() : null;
  const STALE_GRACE_MS   = 5_000;
  const isStale = !!(
    hasContent && healthUpdatedMs && profileUpdatedMs &&
    profileUpdatedMs > healthUpdatedMs + STALE_GRACE_MS
  );

  // ── Source tags ─────────────────────────────────────────────────────────────
  const src = profile?.sources ?? null;
  const sourceTags: string[] = [];
  if (src?.manual_profile?.has_data)                                       sourceTags.push("Profile");
  if (Array.isArray(src?.document_ids) && src.document_ids.length > 0)    sourceTags.push("Records");
  if (src?.apple_health && (
    src.apple_health.steps_avg_7d != null ||
    src.apple_health.sleep_avg_min_7d != null ||
    src.apple_health.resting_hr_recent != null
  ))                                                                        sourceTags.push("Apple Health");

  const showContent = !loading && !error;

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Error ─────────────────────────────────────────── */}
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
            <AppText style={styles.errorText}>{error}</AppText>
          </View>
        ) : null}

        {/* ── Loading ───────────────────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} size="small" />
            <AppText style={styles.loadingText}>Analysing your health data…</AppText>
          </View>
        ) : null}

        {/* ── Stale banner ──────────────────────────────────── */}
        {showContent && isStale ? (
          <View style={styles.staleBanner}>
            <Ionicons name="refresh-outline" size={13} color={colors.teal} />
            <AppText style={styles.staleText}>
              Your profile has changed since this summary was generated.
            </AppText>
            <Pressable
              style={({ pressed }) => [styles.staleBtn, pressed && { opacity: 0.75 }]}
              onPress={() => navigation.navigate("ManageDocuments")}
            >
              <AppText style={styles.staleBtnText}>Refresh</AppText>
            </Pressable>
          </View>
        ) : null}

        {/* ── Context card (overview + sources) ─────────────── */}
        {showContent && overview ? (
          <OverviewCard
            overview={String(overview)}
            sourceTags={sourceTags}
            onPress={() => navigation.navigate("ShinScore")}
          />
        ) : null}

        {/* ── Essentials ────────────────────────────────────── */}
        {showContent && card ? (
          <>
            <SectionEyebrow label="Health Essentials" />
            <View style={styles.contentCard}>
              <View style={styles.cardTitleRow}>
                <AppText
                  style={styles.cardTitle}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  3×5 Emergency Card
                </AppText>

                <Pressable
                  onPress={() => navigation.navigate("Share")}
                  style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="share-outline" size={13} color={colors.teal} />
                  <AppText style={styles.shareBtnText}>Share</AppText>
                </Pressable>
              </View>
              <View style={styles.essentialsList}>
                <EssentialRow label="Blood type"  value={card?.blood_type ?? "Unknown"} />
                <EssentialRow label="Conditions"  value={safeJoin(card?.major_conditions) || "None listed"} />
                <EssentialRow label="Surgeries"   value={safeJoin(card?.major_surgeries) || "None listed"} />
                <EssentialRow label="Medications" value={safeJoin(card?.current_meds) || "None listed"} />
                <EssentialRow label="Allergies"   value={safeJoin(card?.allergies) || "None listed"} />
                <EssentialRow label="Implants"    value={safeJoin(card?.implants_devices) || "None listed"} />
                <EssentialRow label="Anticoag."   value={safeJoin(card?.anticoagulants) || "None listed"} />
                <EssentialRow label="Anesthesia"  value={safeJoin(card?.anesthesia_notes) || "None listed"} />
                {card?.emergency_contact?.name || card?.emergency_contact?.phone ? (
                  <EssentialRow
                    label="Emergency"
                    value={`${card.emergency_contact?.name ?? ""} ${card.emergency_contact?.phone ?? ""}`.trim()}
                  />
                ) : null}
              </View>
              {card?.one_line_summary ? (
                <AppText style={styles.oneLiner}>{String(card.one_line_summary)}</AppText>
              ) : null}
            </View>
          </>
        ) : null}

        {/* ── Full Summary ──────────────────────────────────── */}
        {showContent && fullSummary ? (
          <>
            <SectionEyebrow label="Full Summary" />
            <View style={styles.contentCard}>
              <View style={styles.cardTitleRow}>
                <AppText style={styles.cardTitle}>AI Health Summary</AppText>
                <Pressable
                  onPress={() => navigation.navigate("Share")}
                  style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="share-outline" size={13} color={colors.teal} />
                  <AppText style={styles.shareBtnText}>Share</AppText>
                </Pressable>
              </View>
              <AppText style={styles.fullText}>{String(fullSummary)}</AppText>
            </View>
          </>
        ) : null}

        {/* ── Global empty state ────────────────────────────── */}
        {showContent && !hasContent ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="pulse-outline" size={24} color={colors.teal} />
            </View>
            <AppText style={styles.emptyTitle}>No summary yet</AppText>
            <AppText style={styles.emptyBody}>
              Upload medical records or complete your health profile, then tap Process to generate AI insights.
            </AppText>
            <View style={styles.emptyActions}>
              <Pressable
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
                onPress={() => navigation.navigate("ManageDocuments")}
              >
                <AppText style={styles.emptyBtnText}>Open Documents</AppText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* ── Disclaimer footer ─────────────────────────────── */}
        {showContent && hasContent && disclaimer ? (
          <View style={styles.disclaimerWrap}>
            <Ionicons name="information-circle-outline" size={12} color={colors.subtle} />
            <AppText style={styles.disclaimerText}>{String(disclaimer)}</AppText>
          </View>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

// ─── OverviewCard ─────────────────────────────────────────────────────────────

function OverviewCard({
  overview,
  sourceTags,
  onPress,
}: {
  overview: string;
  sourceTags: string[];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [ov.card, pressed && { opacity: 0.9 }]}
    >
      <View style={ov.header}>
        <View style={ov.iconWrap}>
          <Ionicons name="person-circle-outline" size={14} color={colors.teal} />
        </View>
        <AppText style={ov.eyebrow}>Your Overview</AppText>
      </View>

      <AppText style={ov.text} numberOfLines={3} ellipsizeMode="tail">
        {overview}
      </AppText>

      {sourceTags.length > 0 ? (
        <View style={ov.tagRow}>
          <Ionicons name="layers-outline" size={11} color={colors.subtle} />
          {sourceTags.map((tag) => (
            <View key={tag} style={ov.tag}>
              <AppText style={ov.tagText}>{tag}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const ov = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  text: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
    marginTop: spacing.xxs,
  },
  tag: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    fontWeight: typescale.weight.medium,
  },
});

// ─── SectionEyebrow ───────────────────────────────────────────────────────────

function SectionEyebrow({ label, count }: { label: string; count?: number }) {
  return (
    <View style={sey.row}>
      <AppText style={sey.text}>{label}</AppText>
      {count != null ? (
        <View style={sey.badge}>
          <AppText style={sey.badgeText}>{count}</AppText>
        </View>
      ) : null}
    </View>
  );
}

const sey = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  text: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flex: 1,
  },
  badge: {
    backgroundColor: colors.teal,
    borderRadius: radius.pill,
    minWidth: 20,
    height: 20,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
});

// ─── EssentialRow ─────────────────────────────────────────────────────────────

function EssentialRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={essStyles.row}>
      <AppText
        style={essStyles.label}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </AppText>
      <AppText style={essStyles.value}>{value}</AppText>
    </View>
  );
}

const essStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  label: {
    width: 96,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingTop: 1,
    flexShrink: 0,
  },
  value: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: colors.text,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl + spacing.lg,
  },

  // ── Banners ─────────────────────────────────────────────
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.tealSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  staleText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: colors.teal,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
  staleBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  staleBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },

  // ── Loading ──────────────────────────────────────────────
  center: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typescale.size.sm,
    color: colors.muted,
  },

  // ── Global empty state ───────────────────────────────────
  emptyWrap: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  emptyBody: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
  emptyActions: {
    marginTop: spacing.xs,
  },
  emptyBtn: {
    backgroundColor: colors.teal,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    ...shadows.xs,
  },
  emptyBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: "#fff",
  },

  // ── Content cards (essentials, full summary) ─────────────
  contentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.xs,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xxs,
  },
  cardTitle: {
    flex: 1,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    flexShrink: 0,
  },
  shareBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  fullText: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  essentialsList: {
    gap: 0,
  },
  oneLiner: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    fontStyle: "italic",
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xxs,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // ── Disclaimer footer ────────────────────────────────────
  disclaimerWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  disclaimerText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: colors.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
});
