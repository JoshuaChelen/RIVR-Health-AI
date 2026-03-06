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

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ScoreRing } from "../../components/ui/Home/ScoreRing";
import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";

import exportSummary from "../../lib/health/export.summary.json";

type Props = NativeStackScreenProps<AppStackParamList, "Home">;

type RecentDoc = {
  id: string;
  file_name: string;
  status: "uploaded" | "queued" | "processing" | "done" | "error";
  created_at: string;
};

const STATUS_META: Record<RecentDoc["status"], { label: string; color: string; bg: string }> = {
  uploaded:   { label: "Pending",    color: colors.warning, bg: colors.warnSoft    },
  queued:     { label: "Queued",     color: colors.blue,    bg: colors.blueSoft    },
  processing: { label: "Processing", color: colors.teal,    bg: colors.tealSoft    },
  done:       { label: "Done",       color: colors.success, bg: colors.successSoft },
  error:      { label: "Error",      color: colors.danger,  bg: colors.dangerSoft  },
};

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

export function HomeScreen({ navigation }: Props) {
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);

  const hrText =
    exportSummary.heartRate.latestBpm != null
      ? `${exportSummary.heartRate.latestBpm} bpm`
      : "No data";

  const sleepText =
    exportSummary.sleep.avg7dMinutes != null
      ? `${Math.floor(exportSummary.sleep.avg7dMinutes / 60)}h ${String(
          exportSummary.sleep.avg7dMinutes % 60
        ).padStart(2, "0")}m`
      : "No data";

  const stepsText =
    exportSummary.steps.avg7dPerDay != null
      ? `${exportSummary.steps.avg7dPerDay.toLocaleString()}`
      : "No data";

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setDocsLoading(true);
        const { data: userRes } = await supabase.auth.getUser();
        if (!userRes?.user || !active) return;
        const { data } = await supabase
          .from("documents")
          .select("id, file_name, status, created_at")
          .eq("user_id", userRes.user.id)
          .order("created_at", { ascending: false })
          .limit(4);
        if (active) {
          setRecentDocs((data ?? []) as RecentDoc[]);
          setDocsLoading(false);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ───────────────────────────────────────── */}
        <View style={styles.greeting}>
          <AppText variant="caption" style={styles.greetDate}>{todayLabel()}</AppText>
          <AppText variant="h1" style={styles.greetTitle}>{timeGreeting()}</AppText>
        </View>

        {/* ── Score ring hero ────────────────────────────────── */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <AppText style={styles.heroLabel}>SHIN SCORE</AppText>
              <AppText style={styles.heroSub}>Overall health index</AppText>
            </View>
            <View style={styles.trendPill}>
              <AppText style={styles.trendText}>+3 this week</AppText>
            </View>
          </View>
          <View style={styles.ringWrap}>
            <ScoreRing value={82} />
          </View>
        </View>

        {/* ── AI Insights card ───────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.aiCard, pressed && styles.cardPressed]}
          onPress={() => navigation.navigate("HealthSummary")}
        >
          <View style={styles.aiAccent} />
          <View style={styles.aiBody}>
            <View style={styles.aiHeader}>
              <View style={styles.aiIconWrap}>
                <AppText style={styles.aiIcon}>✦</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={styles.aiTitle}>AI Health Summary</AppText>
                <AppText style={styles.aiSub}>
                  Generate insights from your documents
                </AppText>
              </View>
              <AppText style={styles.aiChevron}>›</AppText>
            </View>
          </View>
        </Pressable>

        {/* ── Quick actions ──────────────────────────────────── */}
        <SectionHeader title="Quick actions" />
        <View style={styles.actionsRow}>
          <QuickAction label="Documents" symbol="📄" onPress={() => navigation.navigate("ManageDocuments")} />
          <QuickAction label="Timeline"  symbol="📅" onPress={() => navigation.navigate("Timeline")} />
          <QuickAction label="Pre-Visit" symbol="🩺" onPress={() => navigation.navigate("PreVisitNote")} />
          <QuickAction label="Share"     symbol="🔗" onPress={() => navigation.navigate("Share")} />
        </View>

        {/* ── Metrics ───────────────────────────────────────── */}
        <SectionHeader title="Today's health" />
        <View style={styles.metricsGrid}>
          <MetricTile symbol="❤️" label="Heart rate" value={hrText}    sub="latest" tone="orange" />
          <MetricTile symbol="💤" label="Sleep"      value={sleepText}  sub="7d avg" tone="blue"   />
          <MetricTile symbol="👟" label="Steps"      value={stepsText}  sub="7d avg" tone="green"  />
          <MetricTile symbol="🧠" label="AI insights" value="2 new"    sub="unread" tone="teal"   onPress={() => navigation.navigate("HealthSummary")} />
        </View>

        {/* ── Recent documents ──────────────────────────────── */}
        <SectionHeader
          title="Recent documents"
          action="See all"
          onAction={() => navigation.navigate("ManageDocuments")}
        />

        {docsLoading ? (
          <View style={styles.docsLoading}>
            <ActivityIndicator color={colors.teal} size="small" />
          </View>
        ) : recentDocs.length === 0 ? (
          <Pressable
            style={({ pressed }) => [styles.emptyCard, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("ManageDocuments")}
          >
            <AppText style={styles.emptySymbol}>📂</AppText>
            <View style={{ flex: 1 }}>
              <AppText style={styles.emptyTitle}>No documents yet</AppText>
              <AppText style={styles.emptyBody}>Upload a PDF or voice note to get started</AppText>
            </View>
            <AppText style={styles.emptyChevron}>›</AppText>
          </Pressable>
        ) : (
          <View style={styles.docList}>
            {recentDocs.map((doc) => {
              const meta = STATUS_META[doc.status] ?? STATUS_META.uploaded;
              return (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [styles.docRow, pressed && styles.cardPressed]}
                  onPress={() => navigation.navigate("ManageDocuments")}
                >
                  <View style={styles.docIconWrap}>
                    <AppText style={styles.docIconText}>📄</AppText>
                  </View>
                  <View style={styles.docInfo}>
                    <AppText style={styles.docName} numberOfLines={1}>{doc.file_name}</AppText>
                    <AppText style={styles.docDate}>
                      {new Date(doc.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </AppText>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <AppText style={[styles.statusText, { color: meta.color }]}>
                      {meta.label}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

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

// ── Shared components ─────────────────────────────────────────────────────────

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={sh.row}>
      <View style={sh.accent} />
      <AppText style={sh.title}>{title}</AppText>
      {action && onAction ? (
        <Pressable onPress={onAction} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <AppText style={sh.link}>{action}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const sh = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  accent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: colors.teal,
  },
  title: {
    flex: 1,
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  link: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
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
      <AppText style={styles.metricValue}>{value}</AppText>
      <AppText style={styles.metricLabel}>{label}</AppText>
      <AppText style={styles.metricSub}>{sub}</AppText>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  },
  greetDate: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  greetTitle: {
    color: colors.text,
  },

  // Hero score card
  heroCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
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
    marginTop: 3,
  },
  trendPill: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  trendText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.success,
  },
  ringWrap: {
    alignItems: "center",
    paddingTop: spacing.xs,
  },

  // AI card
  aiCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    flexDirection: "row",
    overflow: "hidden",
    ...shadows.xs,
  },
  aiAccent: {
    width: 4,
    backgroundColor: colors.teal,
  },
  aiBody: {
    flex: 1,
    padding: spacing.md,
  },
  aiHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  aiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  aiIcon: {
    fontSize: 16,
    color: colors.teal,
    fontWeight: typescale.weight.bold,
  },
  aiTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
  aiSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    marginTop: 2,
  },
  aiChevron: {
    fontSize: 22,
    color: colors.teal,
    fontWeight: typescale.weight.bold,
    lineHeight: 28,
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

  // Card press state (shared)
  cardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },

  // Docs
  docsLoading: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.xs,
  },
  emptySymbol: {
    fontSize: 24,
    lineHeight: 30,
  },
  emptyTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
  emptyBody: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    marginTop: 2,
  },
  emptyChevron: {
    fontSize: 22,
    color: colors.subtle,
    lineHeight: 28,
  },
  docList: {
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
    ...shadows.xs,
  },
  docIconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.xs,
    backgroundColor: colors.bgSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  docIconText: {
    fontSize: 16,
    lineHeight: 20,
  },
  docInfo: {
    flex: 1,
    gap: 2,
  },
  docName: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: colors.text,
  },
  docDate: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
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
