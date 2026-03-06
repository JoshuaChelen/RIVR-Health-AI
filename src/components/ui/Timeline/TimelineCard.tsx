import React from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Switch,
  ViewStyle,
  StyleProp,
} from "react-native";
import { AppText } from "../Primitives/AppText";
import { colors, radius, shadows, typescale } from "../../../theme/tokens";

type PillTone = "green" | "gray" | "pink" | "blue";

type Pill = {
  label: string;
  tone?: PillTone;
  icon?: React.ReactNode;
};

type TimelineCardProps = {
  categoryPill: Pill;
  sourcePill?: Pill;
  leadingIcon?: React.ReactNode;

  title: string;
  dateLabel: string;
  report: string;

  included: boolean;
  onToggleIncluded: (next: boolean) => void;
  onPressEdit?: () => void;
  onPress?: () => void;

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
  onPress,
  style,
}: TimelineCardProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && onPress ? styles.cardPressed : null,
        style,
      ]}
    >
      {/* Header row: pills + edit */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {leadingIcon ? (
            <View style={styles.leadingChip}>{leadingIcon}</View>
          ) : null}
          <PillView {...categoryPill} />
          {sourcePill ? <PillView {...sourcePill} /> : null}
        </View>

        {onPressEdit ? (
          <Pressable
            onPress={onPressEdit}
            hitSlop={10}
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.6 }]}
          >
            <AppText style={styles.editIcon}>✎</AppText>
          </Pressable>
        ) : null}
      </View>

      <AppText variant="title" style={styles.title}>{title}</AppText>
      <AppText variant="caption" style={styles.date}>{dateLabel}</AppText>

      {!!report && (
        <AppText variant="body" style={styles.report}>{report}</AppText>
      )}

      <View style={styles.divider} />

      <View style={styles.footerRow}>
        <AppText variant="caption" style={styles.footerText}>
          Include in Pre-Visit Note
        </AppText>
        <Switch
          value={included}
          onValueChange={onToggleIncluded}
          trackColor={{ false: colors.bgSecondary, true: colors.tealSoft }}
          thumbColor={included ? colors.teal : colors.subtle}
          ios_backgroundColor={colors.bgSecondary}
        />
      </View>
    </Pressable>
  );
}

function PillView({ label, tone = "gray", icon }: Pill) {
  const toneStyle = pillToneStyles[tone];
  return (
    <View style={[styles.pill, toneStyle.container]}>
      {icon ? <View style={styles.pillIcon}>{icon}</View> : null}
      <AppText style={[styles.pillText, toneStyle.text]}>{label}</AppText>
    </View>
  );
}

const pillToneStyles: Record<PillTone, { container: any; text: any }> = {
  green: {
    container: { backgroundColor: colors.greenSoft, borderColor: "#BEEAD3" },
    text:      { color: "#0F7A4A" },
  },
  gray: {
    container: { backgroundColor: colors.bgSecondary, borderColor: colors.border },
    text:      { color: colors.muted },
  },
  pink: {
    container: { backgroundColor: "#FCE7F3", borderColor: "#FBCFE8" },
    text:      { color: "#9D174D" },
  },
  blue: {
    container: { backgroundColor: colors.blueSoft, borderColor: "#BAE6FD" },
    text:      { color: "#075985" },
  },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardPressed: {
    opacity: 0.93,
    transform: [{ scale: 0.99 }],
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    flex: 1,
  },
  leadingChip: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.orangeSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  editIcon: {
    fontSize: 14,
    color: colors.teal,
    fontWeight: typescale.weight.bold,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillIcon:  { marginRight: 5 },
  pillText:  { fontSize: typescale.size.xs, fontWeight: typescale.weight.bold },
  title: {
    color: colors.text,
    marginBottom: 3,
  },
  date: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
    marginBottom: 10,
  },
  report: {
    color: colors.textSub,
    fontSize: typescale.size.sm,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 12,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerText: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
  },
});
