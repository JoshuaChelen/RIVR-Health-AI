import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ScoreRing } from "../../components/ui/Home/ScoreRing";

import { supabase } from "../../lib/supabase";
import {
  getAllDocumentIds,
  getHealthProfile,
  getLatestJob,
  getLatestEvaluation,
  startAiJob,
} from "../../lib/aiJobs";

import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";

// ─── Screen ───────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<AppStackParamList, "ShinScore">;

export function ShinScoreScreen({ navigation }: Props) {
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [job, setJob]           = useState<any>(null);
  const [profile, setProfile]   = useState<any>(null);
  const [evaluation, setEval]   = useState<any>(null);
  const [error, setError]       = useState<string | null>(null);
  const [ringKey, setRingKey]   = useState(0);
  const pollRef                 = useRef<any>(null);

  // Remount the ring on every screen focus so animation always replays
  useFocusEffect(
    useCallback(() => {
      setRingKey(k => k + 1);
    }, [])
  );

  const load = useCallback(async () => {
    setError(null);
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    try {
      const [j, p, ev] = await Promise.all([
        getLatestJob(userRes.user.id),
        getHealthProfile(userRes.user.id),
        getLatestEvaluation(userRes.user.id),
      ]);
      setJob(j);
      setProfile(p);
      setEval(ev?.result ?? null);
      setRunning(!!(j && (j.status === "queued" || j.status === "running")));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) { setError("Not signed in."); return; }
    try {
      setRunning(true);
      const docIds = await getAllDocumentIds(user.id);
      if (docIds.length === 0) {
        setError("Upload at least one document first.");
        setRunning(false);
        return;
      }
      await startAiJob(docIds);
      await load();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(load, 2000);
    } catch (e: any) {
      setError(String(e?.message || e));
      setRunning(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  useEffect(() => {
    const isRunning = job && (job.status === "queued" || job.status === "running");
    if (!isRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setRunning(false);
    }
  }, [job?.status]);

  const score    = profile?.score ?? evaluation?.score_0_to_100;
  const label    = profile?.score_label ?? evaluation?.score_label;
  const overview = profile?.summary_json?.overview ?? evaluation?.overview ?? null;

  // ── Header right: Generate / Refresh ──────────────────────────────────────
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={start} disabled={running} style={styles.headerBtn}>
          <AppText style={[styles.headerBtnText, running && styles.headerBtnDisabled]}>
            {running ? "Running…" : score != null ? "Refresh ↺" : "Generate"}
          </AppText>
        </Pressable>
      ),
    });
  }, [navigation, start, running, score]);

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
            <ActivityIndicator color={colors.teal} size="large" />
            <AppText style={styles.loadingText}>Loading your score…</AppText>
          </View>
        ) : null}

        {/* ── Score card ───────────────────────────────────── */}
        {!loading ? (
          <View style={styles.scoreCard}>
            {/* Section label + analyzing badge */}
            <View style={styles.scoreHeaderRow}>
              <AppText style={styles.scoreSectionLabel}>SHIN SCORE</AppText>
              {running ? (
                <View style={styles.analyzingBadge}>
                  <ActivityIndicator size="small" color={colors.teal} style={styles.analyzingSpinner} />
                  <AppText style={styles.analyzingText}>Analyzing…</AppText>
                </View>
              ) : null}
            </View>

            {/* Score ring */}
            {score != null ? (
              <>
                <View style={styles.ringWrap}>
                  <ScoreRing key={ringKey} value={score} />
                </View>

                {/* Label + overview below the ring */}
                {label ? (
                  <View style={styles.labelRow}>
                    <View style={styles.labelBadge}>
                      <AppText style={styles.labelBadgeText}>{label}</AppText>
                    </View>
                  </View>
                ) : null}

                {overview ? (
                  <View style={styles.overviewBlock}>
                    <View style={styles.overviewAccent} />
                    <AppText style={styles.overviewText}>{String(overview)}</AppText>
                  </View>
                ) : null}
              </>
            ) : !running ? (
              /* Empty state */
              <View style={styles.emptyWrap}>
                <View style={styles.emptyRing}>
                  <AppText style={styles.emptyRingIcon}>✦</AppText>
                </View>
                <AppText style={styles.emptyTitle}>No score yet</AppText>
                <AppText style={styles.emptyBody}>
                  Upload medical documents then tap "Generate" above to calculate your SHIN Score.
                </AppText>
                <Pressable
                  style={({ pressed }) => [styles.generateBtn, pressed && { opacity: 0.8 }]}
                  onPress={start}
                >
                  <AppText style={styles.generateBtnText}>Generate SHIN Score</AppText>
                </Pressable>
              </View>
            ) : (
              /* Running but no score yet */
              <View style={styles.runningWrap}>
                <ActivityIndicator color={colors.teal} size="large" />
                <AppText style={styles.runningText}>Analyzing your health data…</AppText>
                <AppText style={styles.runningSub}>This may take a minute. Stay on this page or check back shortly.</AppText>
              </View>
            )}
          </View>
        ) : null}

        {/* ── View full summary link ────────────────────────── */}
        {score != null && !loading ? (
          <Pressable
            style={({ pressed }) => [styles.summaryLink, pressed && styles.summaryLinkPressed]}
            onPress={() => navigation.navigate("HealthSummary")}
          >
            <View style={styles.summaryLinkIconWrap}>
              <AppText style={styles.summaryLinkIcon}>🧠</AppText>
            </View>
            <View style={styles.summaryLinkText}>
              <AppText style={styles.summaryLinkTitle}>AI Health Summary</AppText>
              <AppText style={styles.summaryLinkSub}>Full summary and 3×5 essentials</AppText>
            </View>
            <AppText style={styles.summaryLinkChevron}>›</AppText>
          </Pressable>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Header button
  headerBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  headerBtnText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  headerBtnDisabled: {
    opacity: 0.45,
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

  // Score card
  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  scoreHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scoreSectionLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    letterSpacing: 1.2,
  },
  analyzingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 4,
  },
  analyzingSpinner: {
    width: 14,
    height: 14,
  },
  analyzingText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },

  // Ring area
  ringWrap: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  labelRow: {
    alignItems: "center",
  },
  labelBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  labelBadgeText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    letterSpacing: 0.3,
  },

  // Overview
  overviewBlock: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xxs,
  },
  overviewAccent: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.tealBorder,
    alignSelf: "stretch",
    marginTop: 2,
    flexShrink: 0,
  },
  overviewText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Empty state
  emptyWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyRingIcon: {
    fontSize: 28,
    color: colors.teal,
    lineHeight: 34,
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
    paddingHorizontal: spacing.md,
  },
  generateBtn: {
    marginTop: spacing.xs,
    backgroundColor: colors.teal,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    ...shadows.xs,
  },
  generateBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: "#fff",
  },

  // Running state (no score yet)
  runningWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  runningText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
  runningSub: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.md,
  },

  // View full summary link card
  summaryLink: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.xs,
  },
  summaryLinkPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  summaryLinkIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  summaryLinkIcon: {
    fontSize: 18,
    lineHeight: 24,
  },
  summaryLinkText: {
    flex: 1,
    gap: 3,
  },
  summaryLinkTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
  summaryLinkSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  summaryLinkChevron: {
    fontSize: 22,
    color: colors.teal,
    lineHeight: 28,
  },
});
