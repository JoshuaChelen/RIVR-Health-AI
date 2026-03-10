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
import { supabase } from "../../lib/supabase";
import { getHealthProfile, getLatestEvaluation } from "../../lib/aiJobs";
import { getProfile } from "../../lib/profile";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ScoreRing } from "../../components/ui/Home/ScoreRing";
import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";

import exportSummary from "../../lib/health/export.summary.json";

type Props = NativeStackScreenProps<AppStackParamList, "Home">;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function HomeScreen({ navigation }: Props) {
  // Health summary score — sourced from health_profiles → health_evaluations fallback
  const [scoreLoading, setScoreLoading] = useState(true);
  const [score, setScore]   = useState<number | null>(null);
  const [label, setLabel]   = useState<string | null>(null);
  const [overview, setOverview] = useState<string | null>(null);
  const [profileInitials, setProfileInitials] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        setScoreLoading(true);
        try {
          const { data: userRes } = await supabase.auth.getUser();
          if (!userRes?.user || !active) return;

          const userId = userRes.user.id;
          const [healthProfile, evalRow, userProfile] = await Promise.all([
            getHealthProfile(userId),
            getLatestEvaluation(userId),
            getProfile(userId),
          ]);

          if (!active) return;

          // Mirror exactly what HealthSummaryScreen does to derive the score
          const evalResult = evalRow?.result ?? null;

          const resolvedScore =
            healthProfile?.score ?? evalResult?.score_0_to_100 ?? null;
          const resolvedLabel =
            healthProfile?.score_label ?? evalResult?.score_label ?? null;
          const resolvedOverview =
            healthProfile?.summary_json?.overview ?? evalResult?.overview ?? null;

          setScore(typeof resolvedScore === "number" ? resolvedScore : null);
          setLabel(typeof resolvedLabel === "string" ? resolvedLabel : null);
          setOverview(typeof resolvedOverview === "string" ? resolvedOverview : null);

          if (userProfile?.first_name) {
            const first = userProfile.first_name[0]?.toUpperCase() ?? "";
            const last  = userProfile.last_name?.[0]?.toUpperCase() ?? "";
            setProfileInitials(first + last);
          }
        } catch {
          // Silently fail on the dashboard — errors are surfaced on Health Summary
        } finally {
          if (active) setScoreLoading(false);
        }
      })();

      return () => { active = false; };
    }, [])
  );

  const hrText =
    exportSummary.heartRate.latestBpm != null
      ? `${exportSummary.heartRate.latestBpm} bpm`
      : "—";

  const sleepText =
    exportSummary.sleep.avg7dMinutes != null
      ? `${Math.floor(exportSummary.sleep.avg7dMinutes / 60)}h ${String(
          exportSummary.sleep.avg7dMinutes % 60
        ).padStart(2, "0")}m`
      : "—";

  const stepsText =
    exportSummary.steps.avg7dPerDay != null
      ? `${exportSummary.steps.avg7dPerDay.toLocaleString()}`
      : "—";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ──────────────────────────────────────── */}
        <View style={styles.greeting}>
          <View style={styles.greetLeft}>
            <AppText style={styles.greetDate}>{todayLabel()}</AppText>
            <AppText variant="h1" style={styles.greetTitle}>{timeGreeting()}</AppText>
          </View>
          <Pressable
            style={({ pressed }) => [styles.profileAvatar, pressed && { opacity: 0.7 }]}
            onPress={() => navigation.navigate("Profile")}
          >
            <AppText style={styles.profileAvatarText}>
              {profileInitials ?? "·"}
            </AppText>
          </Pressable>
        </View>

        {/* ── SHIN Score ring card ───────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.heroCard, pressed && styles.heroPressed]}
          onPress={() =>
            score != null || scoreLoading
              ? navigation.navigate("ShinScore")
              : navigation.navigate("ManageDocuments")
          }
        >
          <View style={styles.heroHeader}>
            <View style={styles.heroLabelBlock}>
              <AppText style={styles.heroLabel}>SHIN SCORE</AppText>
              <AppText style={styles.heroSub}>Overall health index</AppText>
            </View>
            {scoreLoading ? null : score != null ? (
              <View style={styles.labelPill}>
                <AppText style={styles.labelPillText} numberOfLines={1} ellipsizeMode="tail">
                  {label ?? "View details"}
                </AppText>
              </View>
            ) : (
              <View style={[styles.labelPill, styles.labelPillMuted]}>
                <AppText style={styles.labelPillTextMuted} numberOfLines={1} ellipsizeMode="tail">
                  Not generated
                </AppText>
              </View>
            )}
          </View>

          <View style={styles.ringWrap}>
            {scoreLoading ? (
              <View style={styles.ringPlaceholder}>
                <ActivityIndicator color={colors.teal} size="large" />
                <AppText style={styles.ringPlaceholderText}>Loading score…</AppText>
              </View>
            ) : score != null ? (
              <ScoreRing value={score} />
            ) : (
              <View style={styles.emptyScore}>
                <View style={styles.emptyScoreRing}>
                  <AppText style={styles.emptyScoreIcon}>✦</AppText>
                </View>
                <AppText style={styles.emptyScoreTitle}>No score yet</AppText>
                <AppText style={styles.emptyScoreBody}>
                  Tap to upload documents, then{"\n"}generate your AI health summary.
                </AppText>
              </View>
            )}
          </View>
        </Pressable>

        {/* ── AI Health Summary card ─────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.summaryCard, pressed && styles.summaryPressed]}
          onPress={() => navigation.navigate("HealthSummary")}
        >
          <View style={styles.summaryAccent} />
          <View style={styles.summaryIconWrap}>
            <AppText style={styles.summaryIcon}>✦</AppText>
          </View>
          <View style={styles.summaryTextBlock}>
            <AppText style={styles.summaryTitle}>AI Health Summary</AppText>
            <AppText style={styles.summarySub}>Generate insights from your documents</AppText>
          </View>
          <AppText style={styles.summaryChevron}>›</AppText>
        </Pressable>

        {/* ── Actions + metrics grid ─────────────────────────── */}
        <SectionHeader title="Actions" />
        <View style={styles.actionsRow}>
          <QuickAction label="Documents" symbol="📄" onPress={() => navigation.navigate("ManageDocuments")} />
          <QuickAction label="Timeline"  symbol="📅" onPress={() => navigation.navigate("Timeline")} />
          <QuickAction label="Pre-Visit" symbol="🩺" onPress={() => navigation.navigate("PreVisitNote")} />
          <QuickAction label="Share"     symbol="🔗" onPress={() => navigation.navigate("Share")} />
        </View>

        <SectionHeader title="Today's health" />
        <View style={styles.metricsGrid}>
          <MetricTile symbol="❤️" label="Heart rate" value={hrText}   sub="latest" tone="orange" />
          <MetricTile symbol="💤" label="Sleep"      value={sleepText} sub="7d avg" tone="blue"   />
          <MetricTile symbol="👟" label="Steps"      value={stepsText} sub="7d avg" tone="green"  />
          <MetricTile
            symbol="🧠"
            label="SHIN Score"
            value={score != null ? `${score}/100` : "—"}
            sub={label ?? "not generated"}
            tone="teal"
            onPress={() => navigation.navigate("ShinScore")}
          />
        </View>

        {/* ── Sign out ──────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.5 }]}
          onPress={async () => { await supabase.auth.signOut(); }}
        >
          <AppText style={styles.signOutText}>Sign out</AppText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.accent} />
      <AppText style={sh.title}>{title}</AppText>
    </View>
  );
}

const sh = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  accent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: colors.teal,
  },
  title: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});

function QuickAction({
  symbol,
  label,
  onPress,
}: {
  symbol: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickBtn, pressed && styles.quickPressed]}
      onPress={onPress}
    >
      <AppText style={styles.quickSymbol}>{symbol}</AppText>
      <AppText style={styles.quickLabel}>{label}</AppText>
    </Pressable>
  );
}

function MetricTile({
  symbol,
  label,
  value,
  sub,
  tone,
  onPress,
}: {
  symbol: string;
  label: string;
  value: string;
  sub: string;
  tone: "teal" | "blue" | "green" | "orange";
  onPress?: () => void;
}) {
  const softMap: Record<string, string> = {
    teal:   colors.tealSoft,
    blue:   colors.blueSoft,
    green:  colors.greenSoft,
    orange: colors.orangeSoft,
  };
  const dotMap: Record<string, string> = {
    teal:   colors.teal,
    blue:   colors.blue,
    green:  colors.green,
    orange: colors.orange,
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.metricTile,
        { backgroundColor: softMap[tone] },
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.metricTop}>
        <AppText style={styles.metricSymbol}>{symbol}</AppText>
        <View style={[styles.metricDot, { backgroundColor: dotMap[tone] }]} />
      </View>
      <AppText style={styles.metricValue} numberOfLines={1} ellipsizeMode="tail">{value}</AppText>
      <AppText style={styles.metricLabel} numberOfLines={1} ellipsizeMode="tail">{label}</AppText>
      <AppText style={styles.metricSub} numberOfLines={1} ellipsizeMode="tail">{sub}</AppText>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.md,
  },

  // Greeting
  greeting: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greetLeft: {
    flex: 1,
    gap: 3,
    marginRight: spacing.sm,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  profileAvatarText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: "#fff",
    letterSpacing: 0.5,
  },
  greetDate: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  greetTitle: {
    color: colors.text,
  },

  // SHIN Score ring card
  heroCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  heroPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  heroLabelBlock: {
    flex: 1,
    gap: 3,
    marginRight: spacing.xs,
  },
  heroLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    letterSpacing: 1.2,
  },
  heroSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  labelPill: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 140,
    flexShrink: 0,
  },
  labelPillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  labelPillMuted: {
    backgroundColor: colors.bgSecondary,
  },
  labelPillTextMuted: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.muted,
  },
  ringWrap: {
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  ringPlaceholder: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  ringPlaceholderText: {
    fontSize: typescale.size.sm,
    color: colors.muted,
  },
  emptyScore: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyScoreRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyScoreIcon: {
    fontSize: 26,
    color: colors.teal,
    lineHeight: 32,
  },
  emptyScoreTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  emptyScoreBody: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // AI Health Summary card
  summaryCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    ...shadows.xs,
  },
  summaryPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  summaryAccent: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: colors.teal,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    marginRight: spacing.xs,
    flexShrink: 0,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  summaryIcon: {
    fontSize: 15,
    color: colors.teal,
    lineHeight: 20,
  },
  summaryTextBlock: {
    flex: 1,
    gap: 3,
  },
  summaryTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  summarySub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  summaryChevron: {
    fontSize: 22,
    color: colors.teal,
    lineHeight: 28,
    flexShrink: 0,
  },

  // Quick actions
  actionsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xxs,
    ...shadows.xs,
  },
  quickPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  quickSymbol: {
    fontSize: 20,
    lineHeight: 26,
  },
  quickLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
    textAlign: "center",
  },

  // Metrics grid
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  metricTile: {
    width: "47%",
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xxs,
    ...shadows.xs,
  },
  metricTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.xs,
  },
  metricSymbol: {
    fontSize: 20,
    lineHeight: 26,
  },
  metricDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 4,
  },
  metricValue: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    lineHeight: typescale.size.lg * typescale.lineHeight.tight,
  },
  metricLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
    marginTop: 1,
  },
  metricSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },

  // Shared press state
  cardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },

  // Sign out
  signOut: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  signOutText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: colors.subtle,
  },
});
