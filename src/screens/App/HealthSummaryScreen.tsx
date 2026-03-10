import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";

import { supabase } from "../../lib/supabase";
import {
  getHealthProfile,
  getLatestEvaluation,
} from "../../lib/aiJobs";

import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";

function safeJoin(arr: any[]) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "";
}

type Props = NativeStackScreenProps<AppStackParamList, "HealthSummary">;

export default function HealthSummaryScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [evaluation, setEval] = useState<any>(null);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    try {
      const [p, ev] = await Promise.all([
        getHealthProfile(userRes.user.id),
        getLatestEvaluation(userRes.user.id),
      ]);
      setProfile(p);
      setEval(ev?.result ?? null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const score       = profile?.score ?? evaluation?.score_0_to_100;
  const label       = profile?.score_label ?? evaluation?.score_label;
  const overview    = profile?.summary_json?.overview ?? evaluation?.overview ?? null;
  const disclaimer  = profile?.summary_json?.disclaimer ?? evaluation?.disclaimer ?? null;
  const fullSummary = profile?.summary_json?.full_summary_markdown ?? evaluation?.full_summary_markdown ?? null;
  const card        = profile?.card_json ?? evaluation?.three_by_five_card ?? null;

  const hasContent  = !!(fullSummary || card);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Error banner ─────────────────────────────────── */}
        {error ? (
          <View style={styles.errorBanner}>
            <AppText style={styles.errorText}>{error}</AppText>
          </View>
        ) : null}

        {/* ── Loading ──────────────────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
            <AppText style={styles.loadingText}>Loading your health summary…</AppText>
          </View>
        ) : null}

        {/* ── Empty state ──────────────────────────────────── */}
        {!loading && !hasContent ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <AppText style={styles.emptyIconText}>🧠</AppText>
            </View>
            <AppText style={styles.emptyTitle}>No summary yet</AppText>
            <AppText style={styles.emptyBody}>
              Generate your SHIN Score first. Your full AI health summary and 3×5 essentials will appear here.
            </AppText>
            <Pressable
              style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
              onPress={() => navigation.navigate("ShinScore")}
            >
              <AppText style={styles.emptyBtnText}>Go to SHIN Score</AppText>
            </Pressable>
          </View>
        ) : null}

        {/* ── Full Summary ─────────────────────────────────── */}
        {fullSummary ? (
          <View style={styles.contentCard}>
            <View style={styles.contentCardHeader}>
              <AppText style={styles.contentCardTitle}>Full Summary</AppText>
              <Pressable
                onPress={() => navigation.navigate("Share")}
                style={({ pressed }) => [styles.shareNavBtn, pressed && { opacity: 0.75 }]}
              >
                <AppText style={styles.shareNavBtnText}>Share</AppText>
              </Pressable>
            </View>
            <AppText style={styles.fullText}>{String(fullSummary)}</AppText>
            {disclaimer ? (
              <AppText style={styles.disclaimer}>{String(disclaimer)}</AppText>
            ) : null}
          </View>
        ) : null}

        {/* ── 3×5 Essentials ──────────────────────────────── */}
        {card ? (
          <View style={styles.contentCard}>
            <View style={styles.contentCardHeader}>
              <AppText style={styles.contentCardTitle}>3×5 Essentials</AppText>
              <Pressable
                onPress={() => navigation.navigate("Share")}
                style={({ pressed }) => [styles.shareNavBtn, pressed && { opacity: 0.75 }]}
              >
                <AppText style={styles.shareNavBtnText}>Share</AppText>
              </Pressable>
            </View>
            <View style={styles.essentialsList}>
              <EssentialRow label="Blood type"   value={card?.blood_type ?? "Unknown"} />
              <EssentialRow label="Conditions"   value={safeJoin(card?.major_conditions) || "None listed"} />
              <EssentialRow label="Surgeries"    value={safeJoin(card?.major_surgeries) || "None listed"} />
              <EssentialRow label="Medications"  value={safeJoin(card?.current_meds) || "None listed"} />
              <EssentialRow label="Allergies"    value={safeJoin(card?.allergies) || "None listed"} />
              <EssentialRow label="Implants"     value={safeJoin(card?.implants_devices) || "None listed"} />
              <EssentialRow label="Anticoag."    value={safeJoin(card?.anticoagulants) || "None listed"} />
              <EssentialRow label="Anesthesia"   value={safeJoin(card?.anesthesia_notes) || "None listed"} />
              {(card?.emergency_contact?.name || card?.emergency_contact?.phone) ? (
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
        ) : null}

      </ScrollView>
    </Screen>
  );
}

// ─── EssentialRow ─────────────────────────────────────────────────────────────

function EssentialRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={essStyles.row}>
      <AppText style={essStyles.label}>{label}</AppText>
      <AppText style={essStyles.value}>{value}</AppText>
    </View>
  );
}

const essStyles = StyleSheet.create({
  row: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 3,
  },
  label: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: typescale.size.sm,
    color: colors.text,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Error
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium,
  },

  // Loading
  center: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typescale.size.sm,
    color: colors.muted,
  },

  // Empty state
  emptyWrap: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyIconText: {
    fontSize: 26,
    lineHeight: 32,
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
  emptyBtn: {
    marginTop: spacing.xs,
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

  // Content cards (Full Summary, 3×5)
  contentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  contentCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  contentCardTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  shareNavBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  shareNavBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
  },
  fullText: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  disclaimer: {
    fontSize: typescale.size.xs,
    color: colors.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xxs,
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
  },
});
