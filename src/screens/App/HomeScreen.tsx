import React from "react";
import { View, StyleSheet } from "react-native";
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

type Props = NativeStackScreenProps<AppStackParamList, "Home">;
export function HomeScreen({ navigation }: Props) {
  return (
    <Screen style={styles.container}>
      <AppText variant="h1">Shin Score</AppText>

      <View style={{ alignItems: "center", marginVertical: 10 }}>
        <ScoreRing value={82} />
      </View>

      <View style={styles.grid}>
        <MetricCard title="AI Insights" subtitle="2 new" tone="teal" />
        <MetricCard title="Sleep" subtitle="7 hr 44 min avg" tone="blue" />
        <MetricCard title="Preventive Care" subtitle="Up to date" tone="green" />
        <MetricCard title="Heart Rate" subtitle="68 bpm" tone="orange" />
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

function MetricCard({ title, subtitle, tone }: { title: string; subtitle: string; tone: "teal" | "blue" | "green" | "orange" }) {
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
        <AppText variant="title" style={{ fontSize: 15 }}>{title}</AppText>
        <AppText variant="caption">{subtitle}</AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  grid: { 
    flexDirection: "row", 
    flexWrap: "wrap", 
    gap: 12, 
    justifyContent: "space-between" 
  },
  metricCardCustom: { width: "48%", padding: 16, gap: 10 },
  iconDot: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  innerDot: { 
    width: 10, 
    height: 10, 
    borderRadius: 5 
  },
  actionSection: { 
    marginTop: 10, 
    gap: 12 
  },
  heroBtn: {
    height: 54,
    // Adding a small glow/shadow to the main button
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  row: { 
    flexDirection: "row", 
    gap: 12 
  },
  shadowBtn: {
    flex: 1,
    // Subtle shadow for secondary buttons to make them look "clickable"
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    borderColor: colors.border,
    borderWidth: 1,
  },
  logout: {
    marginTop: 4,
  }
});