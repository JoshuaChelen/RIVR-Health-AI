import React from "react";
import { View, Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "../Primitives/AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radius, shadows, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type ActionCardProps = {
  title: string;
  description?: string;
  badgeText?: string;
  icon?: React.ReactNode;
  ctaLabel: string;
  onPress: () => void;
  accentColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

export function ActionCard({
  title,
  description,
  badgeText,
  icon,
  ctaLabel,
  onPress,
  accentColor,
  containerStyle,
  disabled = false,
}: ActionCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const accent = accentColor ?? colors.teal;
  return (
    <View style={[styles.card, containerStyle]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconPill, { backgroundColor: accent + "1A" }]}>
          {icon ?? <Ionicons name="sparkles-outline" size={16} color={accent} />}
        </View>

        {!!badgeText && (
          <View style={styles.badge}>
            <AppText variant="label" style={styles.badgeText}>{badgeText}</AppText>
          </View>
        )}
      </View>

      <AppText variant="title" style={styles.title}>{title}</AppText>
      {!!description && (
        <AppText variant="muted" style={styles.desc}>{description}</AppText>
      )}

      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessible
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: accent },
          disabled && { opacity: 0.45 },
          pressed && !disabled && { opacity: 0.85 },
        ]}
      >
        <AppText style={styles.ctaText}>{ctaLabel}</AppText>
      </Pressable>
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
    ...shadows.card,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  iconPill: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    backgroundColor: c.warnSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: c.warning,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  title: {
    color: c.text,
    marginBottom: 6,
  },
  desc: {
    marginBottom: 14,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  cta: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ctaText: {
    color: "#fff",
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.sm,
  },
}));
