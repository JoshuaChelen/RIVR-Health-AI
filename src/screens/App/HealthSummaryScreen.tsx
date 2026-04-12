import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { supabase } from "../../lib/supabase";
import { getHealthProfile, getLatestEvaluation } from "../../lib/aiJobs";
import { getProfile } from "../../lib/profile";
import { getCurrentUserId } from "../../lib/auth";
import { triggerProfileEvalAfterSave } from "../../lib/triggerProfileEval";
import { captureException } from "../../lib/sentry";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { radius, shadows, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function manualProfileSignature(p: any) {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const text = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };

  return JSON.stringify({
    date_of_birth: p?.date_of_birth ?? null,
    sex_or_gender: p?.sex_or_gender ?? null,
    current_symptoms: text(p?.current_symptoms),
    smoking_status: p?.smoking_status ?? null,
    alcohol_use: p?.alcohol_use ?? null,
    exercise_level: p?.exercise_level ?? null,
    allergies: list(p?.allergies),
    medications: list(p?.medications),
    medical_history: list(p?.medical_history),
    surgical_history: list(p?.surgical_history),
    family_history: list(p?.family_history),
    hospitalizations: list(p?.hospitalizations),
    social_history: list(p?.social_history),
  });
}


function safeJoin(arr: any[]) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "";
}

type Props = NativeStackScreenProps<AppStackParamList, "HealthSummary">;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HealthSummaryScreen({ navigation }: Props) {
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [profile, setProfile]         = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [evaluation, setEval]         = useState<any>(null);
  const [evalCreatedAt, setEvalCreatedAt] = useState<string | null>(null);
  const [latestDocProcessedAt, setLatestDocProcessedAt] = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const userIdRef                     = useRef<string | null>(null);

  const styles = useStyles();
  const { colors } = useTheme();

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const userId = await getCurrentUserId();
      userIdRef.current = userId;
      const [p, ev, up, latestDoc] = await Promise.all([
        getHealthProfile(userId),
        getLatestEvaluation(userId),
        getProfile(userId),
        supabase
          .from("documents")
          .select("processed_at")
          .eq("user_id", userId)
          .eq("status", "processed")
          .not("processed_at", "is", null)
          .order("processed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setProfile(p);
      setEval(ev?.result ?? null);
      setEvalCreatedAt(ev?.created_at ?? null);
      setLatestDocProcessedAt(latestDoc.data?.processed_at ?? null);
      setUserProfile(up);
    } catch (e: any) {
      captureException(e);
      setError(e?.message ?? "Failed to load health summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Realtime: reload when health_profiles row is updated ────────────────────
  useEffect(() => {
    const userId = userIdRef.current;
    if (!userId) return;

    const channel = supabase
      .channel(`health-profile:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "health_profiles",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Health profile was updated (e.g. after a new evaluation) — reload.
          load();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loading, load]);

  // ── Refresh handler: trigger re-evaluation then reload ──────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await triggerProfileEvalAfterSave();
    } catch {
      // Eval enqueue failed — still reload in case data is already fresh
    }
    // Reload immediately so user sees current data while eval runs
    await load();
    setRefreshing(false);
  }, [load]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const summaryJson  = profile?.summary_json ?? null;
  const disclaimer   = summaryJson?.disclaimer ?? evaluation?.disclaimer ?? null;
  const overview     = summaryJson?.overview ?? null;
  const fullSummary  = summaryJson?.full_summary_markdown ?? evaluation?.full_summary_markdown ?? null;
  const card         = profile?.card_json ?? evaluation?.three_by_five_card ?? null;

  const hasContent = !!(fullSummary || card);

  // ── Staleness ───────────────────────────────────────────────────────────────
  const savedManualProfileSig =
    profile?.sources?.manual_profile?.signature ?? null;

  const currentManualProfileSig =
    userProfile ? manualProfileSignature(userProfile) : null;

  const isStaleProfile = !!(
    hasContent &&
    savedManualProfileSig &&
    currentManualProfileSig &&
    savedManualProfileSig !== currentManualProfileSig
  );

  const isStaleDoc = !!(
    hasContent &&
    latestDocProcessedAt &&
    evalCreatedAt &&
    new Date(latestDocProcessedAt).getTime() > new Date(evalCreatedAt).getTime()
  );

  const isStale = isStaleProfile || isStaleDoc;

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
          <ErrorBanner message="Couldn't load your health summary" onRetry={load} />
        ) : null}

        {/* ── Loading ───────────────────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} size="small" accessibilityLabel="Loading health summary" />
            <AppText style={styles.loadingText}>Analysing your health data…</AppText>
          </View>
        ) : null}

        {/* ── Stale banner ──────────────────────────────────── */}
        {showContent && isStale ? (
          <View style={styles.staleBanner}>
            <Ionicons name="refresh-outline" size={13} color={colors.teal} />
            <AppText style={styles.staleText}>
              {isStaleProfile && isStaleDoc
                ? "Your profile and documents have changed since your last summary."
                : isStaleDoc
                ? "New documents have been processed since your last summary."
                : "Your medical profile has changed since your last summary."}
            </AppText>
            <Pressable
              style={({ pressed }) => [styles.staleBtn, pressed && { opacity: 0.75 }]}
              onPress={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <AppText style={styles.staleBtnText}>Refresh</AppText>
              )}
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
        {showContent && hasContent ? (
          <View style={styles.disclaimerWrap}>
            <Ionicons name="information-circle-outline" size={12} color={colors.subtle} />
            <AppText style={styles.disclaimerText}>
              {disclaimer
                ? String(disclaimer)
                : "This summary is AI-generated from the health data you provided and is for informational purposes only. It is not a medical diagnosis or substitute for professional medical advice. Always consult a qualified healthcare provider."}
            </AppText>
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
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ov_card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.ov_header}>
        <View style={styles.ov_iconWrap}>
          <Ionicons name="person-circle-outline" size={14} color={colors.teal} />
        </View>
        <AppText style={styles.ov_eyebrow}>Your Overview</AppText>
      </View>

      <AppText style={styles.ov_text} numberOfLines={3} ellipsizeMode="tail">
        {overview}
      </AppText>

      {sourceTags.length > 0 ? (
        <View style={styles.ov_tagRow}>
          <Ionicons name="layers-outline" size={11} color={colors.subtle} />
          {sourceTags.map((tag) => (
            <View key={tag} style={styles.ov_tag}>
              <AppText style={styles.ov_tagText}>{tag}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── SectionEyebrow ───────────────────────────────────────────────────────────

function SectionEyebrow({ label, count }: { label: string; count?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.sey_row}>
      <AppText style={styles.sey_text}>{label}</AppText>
      {count != null ? (
        <View style={styles.sey_badge}>
          <AppText style={styles.sey_badgeText}>{count}</AppText>
        </View>
      ) : null}
    </View>
  );
}

// ─── EssentialRow ─────────────────────────────────────────────────────────────

function EssentialRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.ess_row}>
      <AppText
        style={styles.ess_label}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </AppText>
      <AppText style={styles.ess_value}>{value}</AppText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
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
    backgroundColor: c.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: c.dangerBorder,
  },
  errorText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: c.danger,
    fontWeight: typescale.weight.medium,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.tealSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: c.tealBorder,
  },
  staleText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: c.teal,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
  staleBtn: {
    backgroundColor: c.teal,
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
    color: c.muted,
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
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  emptyBody: {
    fontSize: typescale.size.sm,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
  emptyActions: {
    marginTop: spacing.xs,
  },
  emptyBtn: {
    backgroundColor: c.teal,
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
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
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
    color: c.text,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.tealBorder,
    flexShrink: 0,
  },
  shareBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },
  fullText: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  essentialsList: {
    gap: 0,
  },
  oneLiner: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    fontStyle: "italic",
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
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
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // ── OverviewCard ────────────────────────────────────────
  ov_card: {
    backgroundColor: c.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  ov_header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  ov_iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  ov_eyebrow: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  ov_text: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  ov_tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
    marginTop: spacing.xxs,
  },
  ov_tag: {
    backgroundColor: c.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: c.border,
  },
  ov_tagText: {
    fontSize: typescale.size.xs,
    color: c.muted,
    fontWeight: typescale.weight.medium,
  },

  // ── SectionEyebrow ─────────────────────────────────────
  sey_row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  sey_text: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flex: 1,
  },
  sey_badge: {
    backgroundColor: c.teal,
    borderRadius: radius.pill,
    minWidth: 20,
    height: 20,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  sey_badgeText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },

  // ── EssentialRow ────────────────────────────────────────
  ess_row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
    gap: spacing.sm,
  },
  ess_label: {
    width: 96,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingTop: 1,
    flexShrink: 0,
  },
  ess_value: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: c.text,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
  },
}));
