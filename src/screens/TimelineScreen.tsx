// src/screens/TimelineScreen.tsx
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ActionCard } from "../components/ui/ActionCard";
import { TimelineCard } from "../components/ui/TimelineCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { MonthDivider } from "../components/ui/MonthDivider";
type Props = NativeStackScreenProps<RootStackParamList, "Timeline">;

export function TimelineScreen({ route }: Props) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader title="Health Timeline" />

      <MonthDivider label={"October 2025"} />

      <TimelineCard
        categoryPill={{ label: "Lifestyle", tone: "pink" }}
        sourcePill={{ label: "AI Guided", tone: "gray" }}
        leadingIcon={<Text style={{ color: "#BE185D", fontWeight: "900" }}>♥</Text>}
        title="Physical Activity Increase"
        dateLabel="October 22, 2025"
        report="Average daily steps increased from 4,800 to 7,200 over the past month..."
        included={true}
        onToggleIncluded={() => {}}
        onPressEdit={() => {}}
      />

      <MonthDivider label={"November 2025"} />

      <TimelineCard
        categoryPill={{ label: "Vitals", tone: "green" }}
        sourcePill={{ label: "Document Upload", tone: "gray" }}
        leadingIcon={<Text style={{ color: "#15803D", fontWeight: "900" }}>∿</Text>}
        title="Blood Glucose Summary"
        dateLabel="November 6, 2025"
        report="Fasting glucose from recent lab panel measured at 94 mg/dL..."
        included={false}
        onToggleIncluded={() => {}}
        onPressEdit={() => {}}
      />

      <TimelineCard
        categoryPill={{ label: "Vitals", tone: "green" }}
        sourcePill={{ label: "Manual Entry", tone: "gray" }}
        leadingIcon={<Text style={{ fontWeight: "900", color: "#B45309" }}>∿</Text>}
        title="Weight Measurement"
        dateLabel="November 17, 2025"
        report="Current weight: 165 lbs (down from 172 in June)..."
        included={true}
        onToggleIncluded={() => {}}
        onPressEdit={() => {}}
      />

      <MonthDivider label="December 2025" />

      <TimelineCard
        categoryPill={{ label: "Medications", tone: "blue" }}
        sourcePill={{ label: "Manual Entry", tone: "gray" }}
        leadingIcon={<Text style={{ color: "#0369A1", fontWeight: "900" }}>⚕</Text>}
        title="Medication Adherence Check"
        dateLabel="December 3, 2025"
        report="Continued adherence to prescribed blood pressure medication..."
        included={true}
        onToggleIncluded={() => {}}
        onPressEdit={() => {}}
      />

      <SectionHeader title="Action Needed" />

      {/* Action section grid */}
      <View style={styles.actionGrid}>
        <ActionCard
          title="Add Recent Lab Results"
          description="You mentioned getting labs done last week..."
          badgeText="Priority"
          icon={<Text>⬇️</Text>}
          ctaLabel="Add Labs"
          onPress={() => {}}
          accentColor="#22c55e"
          containerStyle={styles.card}
        />

        <ActionCard
          title="Sleep Quality Improvement"
          description="Your wearable showed better sleep this week..."
          badgeText="Priority"
          icon={<Text>🌙</Text>}
          ctaLabel="Add Sleep Data"
          onPress={() => {}}
          accentColor="#3b82f6"
          containerStyle={styles.card}
        />
      </View>
    </ScrollView>
  );
}


const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    width: "48%",
  },
});

