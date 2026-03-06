import React from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { Card } from "../../components/ui/Primitives/Card";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { GhostButton } from "../../components/ui/Primitives/GhostButton";
import { ScoreRing } from "../../components/ui/Home/ScoreRing";
import { colors, spacing, typescale } from "../../theme/tokens";

import { useAppleHealthHome } from "../../hooks/useAppleHealthHome";
import exportSummary from "../../lib/health/export.summary.json";

type Props = NativeStackScreenProps<AppStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const health = useAppleHealthHome();

  const hrText =
    exportSummary.heartRate.latestBpm != null
      ? `${exportSummary.heartRate.latestBpm} bpm`
      : "No data";

  const sleepText =
    exportSummary.sleep.avg7dMinutes != null
      ? `${Math.floor(exportSummary.sleep.avg7dMinutes / 60)}h ${String(
          exportSummary.sleep.avg7dMinutes % 60
        ).padStart(2, "0")}m avg`
      : "No data";

  const stepsText =
    exportSummary.steps.avg7dPerDay != null
      ? `${exportSummary.steps.avg7dPerDay.toLocaleString()} / day`
      : "No data";

  return (
    <Screen style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" style={styles.greeting}>Health overview</AppText>
          <AppText variant="h1">Shin Score</AppText>
          {health.status === "linked" && health.lastSync ? (
            <AppText variant="caption" style={{ marginTop: 2 }}>
              Synced {health.lastSync.toLocaleTimeString()}
            </AppText>
          ) : null}
        </View>
        {health.refreshing ? <ActivityIndicator color={colors.teal} /> : null}
      </View>

      {/* Score ring */}
      <View style={styles.ringWrap}>
        <ScoreRing value={82} />
      </View>

      {/* Metric grid */}
      <View style={styles.grid}>
        <MetricCard title="AI Insights"  subtitle="2 new"    tone="teal"   />
        <MetricCard title="Sleep"        subtitle={sleepText} tone="blue"   />
        <MetricCard title="Steps"        subtitle={stepsText} tone="green"  />
        <MetricCard title="Heart Rate"   subtitle={hrText}    tone="orange" />
      </View>

      {/* Navigation actions */}
      <View style={styles.actions}>
        <PrimaryButton
          label="Manage Documents"
          style={styles.primaryBtn}
          onPress={() => navigation.navigate("ManageDocuments")}
        />

        <View style={styles.secondaryRow}>
          <SecondaryButton
            label="Timeline"
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate("Timeline")}
          />
          <SecondaryButton
            label="Summary"
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate("HealthSummary")}
          />
          <SecondaryButton
            label="Share"
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate("Share")}
          />
        </View>

        <GhostButton
          label="Sign out"
          style={styles.signOut}
          onPress={async () => { await supabase.auth.signOut(); }}
        />
      </View>
    </Screen>
  );
}

function MetricCard({
  title,
  subtitle,
  tone,
}: {
  title: string;
  subtitle: string;
  tone: "teal" | "blue" | "green" | "orange";
}) {
  const toneMap = {
    teal:   { dot: colors.teal,   soft: colors.tealSoft   },
    blue:   { dot: colors.blue,   soft: colors.blueSoft   },
    green:  { dot: colors.green,  soft: colors.greenSoft  },
    orange: { dot: colors.orange, soft: colors.orangeSoft },
  }[tone];

  return (
    <Card style={styles.metricCard}>
      <View style={[styles.iconWrap, { backgroundColor: toneMap.soft }]}>
        <View style={[styles.iconDot, { backgroundColor: toneMap.dot }]} />
      </View>
      <AppText variant="title" style={styles.metricTitle}>{title}</AppText>
      <AppText variant="caption" style={styles.metricSubtitle}>{subtitle}</AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  greeting: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
    letterSpacing: 0.3,
    marginBottom: 2,
  },

  ringWrap: {
    alignItems: "center",
    marginVertical: spacing.sm,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    width: "48%",
    padding: spacing.md,
    gap: spacing.xs,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  metricTitle: {
    fontSize: typescale.size.base,
    marginTop: 2,
  },
  metricSubtitle: {
    color: colors.muted,
  },

  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryBtn: {
    height: 52,
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
  },
  signOut: {
    marginTop: spacing.xs,
  },
});
