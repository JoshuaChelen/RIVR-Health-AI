import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
  ViewStyle,
  StyleProp,
} from "react-native";

type PillTone = "green" | "gray" | "pink" | "blue";

type Pill = {
  label: string;
  tone?: PillTone;
  icon?: React.ReactNode;
};

type TimelineCardProps = {
  // header pills
  categoryPill: Pill;        // e.g. { label: "Vitals", tone: "green" }
  sourcePill?: Pill;         // e.g. { label: "Manual Entry", tone: "gray" }

  // small icon chip (left)
  leadingIcon?: React.ReactNode; // e.g. <Text>∿</Text> or vector icon

  // content
  title: string;             // "Weight Measurement"
  dateLabel: string;         // "November 17, 2025"
  report: string;            // paragraph body

  // actions
  included: boolean;
  onToggleIncluded: (next: boolean) => void;
  onPressEdit?: () => void;

  style?: StyleProp<ViewStyle>;
};

export function TimelineCard({
  categoryPill,
  sourcePill,
  leadingIcon,
  title,
  dateLabel,
  report,
  included,
  onToggleIncluded,
  onPressEdit,
  style,
}: TimelineCardProps) {
  return (
    <View style={[styles.card, style]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.leadingChip}>
            {leadingIcon ?? <Text style={styles.leadingFallback}>∿</Text>}
          </View>

          <PillView {...categoryPill} />
          {sourcePill ? <PillView {...sourcePill} /> : null}
        </View>

        {onPressEdit ? (
          <Pressable
            onPress={onPressEdit}
            hitSlop={10}
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.editIcon}>✎</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Content */}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.date}>{dateLabel}</Text>

      <Text style={styles.report}>{report}</Text>

      <View style={styles.divider} />

      {/* Footer */}
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Include in Pre-Visit Note</Text>
        <Switch
          value={included}
          onValueChange={onToggleIncluded}
        />
      </View>
    </View>
  );
}

function PillView({ label, tone = "gray", icon }: Pill) {
  const toneStyle = pillToneStyles[tone];
  return (
    <View style={[styles.pill, toneStyle.container]}>
      {icon ? <View style={styles.pillIcon}>{icon}</View> : null}
      <Text style={[styles.pillText, toneStyle.text]}>{label}</Text>
    </View>
  );
}

const pillToneStyles: Record<PillTone, { container: any; text: any }> = {
  green: {
    container: { backgroundColor: "#E7F7EF", borderColor: "#BEEAD3" },
    text: { color: "#0F7A4A" },
  },
  gray: {
    container: { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" },
    text: { color: "#475569" },
  },
  pink: {
    container: { backgroundColor: "#FCE7F3", borderColor: "#FBCFE8" },
    text: { color: "#9D174D" },
  },
  blue: {
    container: { backgroundColor: "#E0F2FE", borderColor: "#BAE6FD" },
    text: { color: "#075985" },
  },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E6EEF5",
    shadowColor: "#0B1220",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    flex: 1,
  },
  leadingChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#FFE9D9",
    alignItems: "center",
    justifyContent: "center",
  },
  leadingFallback: {
    fontSize: 14,
    color: "#B45309",
    fontWeight: "700",
  },
  editBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  editIcon: {
    fontSize: 14,
    color: "#16A34A",
    fontWeight: "800",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillIcon: { marginRight: 6 },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    fontWeight: "700",
    color: "#16A34A",
    marginBottom: 10,
  },
  report: {
    fontSize: 12.8,
    lineHeight: 18,
    color: "#334155",
  },
  divider: {
    height: 1,
    backgroundColor: "#EEF2F7",
    marginVertical: 12,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#16A34A",
  },
});
