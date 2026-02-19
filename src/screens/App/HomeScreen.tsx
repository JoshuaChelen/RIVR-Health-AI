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
import { colors } from "../../theme/tokens";

import { useAppleHealthHome } from "../../hooks/useAppleHealthHome";

type Props = NativeStackScreenProps<AppStackParamList, "Home">;

import exportSummary from "../../lib/health/export.summary.json";

export function HomeScreen({ navigation }: Props) {
  const health = useAppleHealthHome();

  const sleepSubtitle =
    health.status === "linked"
      ? `${health.sleepAvgText} avg`
      : health.status === "loading"
      ? "Loading..."
      : health.status === "unsupported"
      ? "Not available"
      : "Link Apple Health";

  const hrSubtitle =
    health.status === "linked"
      ? `${health.heartRate ?? "--"} bpm`
      : health.status === "loading"
      ? "Loading..."
      : health.status === "unsupported"
      ? "Not available"
      : "Link Apple Health";

  const hrText =
    exportSummary.heartRate.latestBpm != null
      ? `${exportSummary.heartRate.latestBpm} bpm`
      : "No heart rate in export";

  const sleepText =
    exportSummary.sleep.avg7dMinutes != null
      ? `${Math.floor(exportSummary.sleep.avg7dMinutes / 60)} hr ${String(
          exportSummary.sleep.avg7dMinutes % 60
        ).padStart(2, "0")} min avg`
      : "No sleep in export";

  const stepsText =
    exportSummary.steps.avg7dPerDay != null
      ? `${exportSummary.steps.avg7dPerDay.toLocaleString()} / day avg`
      : "--";

  return (
    <Screen style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <AppText variant="h1">Shin Score</AppText>
          {health.status === "linked" && health.lastSync ? (
            <AppText variant="caption" style={{ marginTop: 2 }}>
              Last sync: {health.lastSync.toLocaleTimeString()}
            </AppText>
          ) : null}
        </View>

        {health.refreshing ? <ActivityIndicator color={colors.teal} /> : null}
      </View>

      <View style={{ alignItems: "center", marginVertical: 10 }}>
        <ScoreRing value={82} />
      </View>

      {/* DON'T DELETE THIS WILL BE FOR WHEN WE HAVE X CODE AND WE ARE DEVELOPING IN IOS
      {health.status === "unlinked" && (
        <Card style={{ padding: 16 }}>
          <AppText variant="title">Link Apple Health</AppText>
          <AppText variant="caption">Connect to pull your heart rate and sleep automatically.</AppText>
          <View style={{ height: 12 }} />
          <PrimaryButton label="Link Apple Health" onPress={health.link} />
        </Card>
      )}

      {health.status === "unlinked" ? (
        <Card style={styles.linkCard}>
          <AppText variant="title">Link Apple Health</AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            Connect to show your sleep and heart rate automatically.
          </AppText>

          <PrimaryButton
            label="Link Apple Health"
            onPress={health.link}
            style={{ marginTop: 12 }}
          />
        </Card>
      ) : null}

      {health.status === "unsupported" ? (
        <Card style={styles.linkCard}>
          <AppText variant="title">Apple Health not available</AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            This device cannot access Apple Health data.
          </AppText>
        </Card>
      ) : null}

      <View style={styles.grid}>
        <MetricCard title="AI Insights" subtitle="2 new" tone="teal" />
        <MetricCard title="Sleep" subtitle={sleepSubtitle} tone="blue" />
        <MetricCard title="Preventive Care" subtitle="Up to date" tone="green" />
        <MetricCard title="Heart Rate" subtitle={hrSubtitle} tone="orange" />
      </View> */}

      <View style={styles.grid}>
        <MetricCard title="AI Insights" subtitle="2 new" tone="teal" />
        <MetricCard title="Sleep" subtitle={sleepText} tone="blue" />
        <MetricCard title="Steps" subtitle={stepsText} tone="green" />
        <MetricCard title="Heart Rate" subtitle={hrText} tone="orange" />
      </View>

      <View style={styles.actionSection}>
        <PrimaryButton
          label="Manage Documents"
          style={styles.heroBtn}
          onPress={() => navigation.navigate("ManageDocuments")}
        />

        <View style={styles.row}>
          <SecondaryButton
            label="Timeline"
            style={styles.shadowBtn}
            onPress={() => navigation.navigate("Timeline")}
          />
          {/* Added Health Summary Button Here */}
          <SecondaryButton
            label="Health Summary"
            style={styles.shadowBtn}
            onPress={() => navigation.navigate("HealthSummary")}
          />
          <SecondaryButton
            label="Share"
            style={styles.shadowBtn}
            onPress={() => navigation.navigate("Share")}
          />
        </View>

        <GhostButton
          label="Logout"
          style={styles.logout}
          onPress={async () => {
            await supabase.auth.signOut();
          }}
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
    teal: { dot: colors.teal, soft: colors.tealSoft },
    blue: { dot: colors.blue, soft: colors.blueSoft },
    green: { dot: colors.green, soft: colors.greenSoft },
    orange: { dot: colors.orange, soft: colors.orangeSoft },
  }[tone];

  return (
    <Card style={styles.metricCardCustom}>
      <View style={[styles.iconDot, { backgroundColor: toneMap.soft }]}>
        <View style={[styles.innerDot, { backgroundColor: toneMap.dot }]} />
      </View>
      <View>
        <AppText variant="title" style={{ fontSize: 15 }}>
          {title}
        </AppText>
        <AppText variant="caption">{subtitle}</AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  linkCard: { padding: 16 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  metricCardCustom: { width: "48%", padding: 16, gap: 10 },
  iconDot: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  innerDot: { width: 10, height: 10, borderRadius: 5 },

  actionSection: { marginTop: 10, gap: 12 },
  heroBtn: {
    height: 54,
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  row: { flexDirection: "row", gap: 12 },
  shadowBtn: {
    flex: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    borderColor: colors.border,
    borderWidth: 1,
  },
  logout: { marginTop: 4 },
});