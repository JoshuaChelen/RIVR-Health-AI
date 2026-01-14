// components/ActionCard.tsx
import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from "react-native";

type ActionCardProps = {
  title: string;
  description?: string;

  // top-right badge (e.g., "Priority")
  badgeText?: string;

  // left icon area (use emoji, SVG, or an icon component)
  icon?: React.ReactNode;

  // CTA button
  ctaLabel: string;
  onPress: () => void;

  // styling knobs
  accentColor?: string; // used for icon bg + button bg
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
  accentColor = "#22c55e",
  containerStyle,
  disabled = false,
}: ActionCardProps) {
  return (
    <View style={[styles.card, containerStyle]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconPill, { backgroundColor: withAlpha(accentColor, 0.12) }]}>
          {icon ?? <Text style={styles.iconFallback}>★</Text>}
        </View>

        {!!badgeText && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeText}</Text>
          </View>
        )}
      </View>

      <Text style={styles.title}>{title}</Text>
      {!!description && <Text style={styles.desc}>{description}</Text>}

      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: accentColor, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </Pressable>
    </View>
  );
}

function withAlpha(hex: string, alpha: number) {
  // supports #RRGGBB only
  const a = Math.round(alpha * 255);
  const aa = a.toString(16).padStart(2, "0");
  return `${hex}${aa}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E8EEF4",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  iconPill: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconFallback: { fontSize: 16 },
  badge: {
    backgroundColor: "#FFE7D6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#C2410C",
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 6,
  },
  desc: {
    fontSize: 12.5,
    lineHeight: 18,
    color: "#475569",
    marginBottom: 12,
  },
  cta: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ctaText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12.5,
  },
});
