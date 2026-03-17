import React, { useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Switch,
  Animated,
  ViewStyle,
  StyleProp,
} from "react-native";
import { AppText } from "../Primitives/AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, shadows, spacing, typescale } from "../../../theme/tokens";

// ─── Category config ──────────────────────────────────────────────────────────

type CategoryMeta = {
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  pillBg: string;
  pillText: string;
  dot: string;
};

const DEFAULT_META: CategoryMeta = {
  iconName: "ellipse-outline",
  iconColor: colors.orange,
  iconBg: colors.orangeSoft,
  pillBg: colors.orangeSoft,
  pillText: colors.orange,
  dot: colors.orange,
};

const CATEGORY_MAP: Array<{ test: (c: string) => boolean; meta: CategoryMeta }> = [
  {
    test: (c) => c.includes("med"),
    meta: {
      iconName: "medkit-outline",
      iconColor:  "#075985",
      iconBg:     colors.blueSoft,
      pillBg:     colors.blueSoft,
      pillText:   "#075985",
      dot:        colors.blue,
    },
  },
  {
    test: (c) => c.includes("vital") || c.includes("lab"),
    meta: {
      iconName:   "pulse-outline",
      iconColor:  colors.green,
      iconBg:     colors.greenSoft,
      pillBg:     colors.greenSoft,
      pillText:   colors.green,
      dot:        colors.green,
    },
  },
  {
    test: (c) => c.includes("life") || c.includes("habit"),
    meta: {
      iconName: "heart-outline",
      iconColor:  "#9D174D",
      iconBg:     "#FCE7F3",
      pillBg:     "#FCE7F3",
      pillText:   "#9D174D",
      dot:        "#BE185D",
    },
  },
  {
    test: (c) => c.includes("visit") || c.includes("appoint"),
    meta: {
      iconName: "calendar-outline",
      iconColor:  colors.teal,
      iconBg:     colors.tealSoft,
      pillBg:     colors.tealSoft,
      pillText:   colors.teal,
      dot:        colors.teal,
    },
  },
];

export function categoryMeta(category: string): CategoryMeta {
  const c = (category ?? "").toLowerCase();
  return CATEGORY_MAP.find((m) => m.test(c))?.meta ?? DEFAULT_META;
}

// ─── Props ────────────────────────────────────────────────────────────────────

type TimelineCardProps = {
  title: string;
  dateLabel: string;
  category: string;
  source?: string;
  summary: string;
  included: boolean;
  onToggleIncluded: (next: boolean) => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TimelineCard({
  title,
  dateLabel,
  category,
  source,
  summary,
  included,
  onToggleIncluded,
  onPress,
  style,
}: TimelineCardProps) {
  const meta = categoryMeta(category);
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn  = () =>
    Animated.spring(scale, { toValue: 0.985, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 25 }).start();

  const sourceLabel = prettySource(source);
  const cleanCategory = (category ?? "").trim() || "Other";

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPress ? onPressIn : undefined}
        onPressOut={onPress ? onPressOut : undefined}
        disabled={!onPress}
        style={styles.card}
      >
        {/* ── Top row: icon + title + date ── */}
        <View style={styles.topRow}>
          <View style={[styles.iconWrap, { backgroundColor: meta.iconBg }]}>
            <Ionicons name={meta.iconName} size={18} color={meta.iconColor} />
          </View>

          <View style={styles.titleBlock}>
            <AppText style={styles.title} numberOfLines={2}>{title}</AppText>
            {sourceLabel ? (
              <AppText style={styles.source}>{sourceLabel}</AppText>
            ) : null}
          </View>

          <AppText style={styles.date}>{dateLabel}</AppText>
        </View>

        {/* ── Summary ── */}
        {summary?.trim() ? (
          <AppText style={styles.summary} numberOfLines={3}>
            {summary.trim()}
          </AppText>
        ) : null}

        {/* ── Footer: category pill + include toggle ── */}
        <View style={styles.footer}>
          <View style={[styles.catPill, { backgroundColor: meta.pillBg }]}>
            <AppText style={[styles.catText, { color: meta.pillText }]}>
              {cleanCategory}
            </AppText>
          </View>

          <View style={styles.includeRow}>
            <AppText style={[styles.includeLabel, included && styles.includeLabelActive]}>
              Pre-Visit
            </AppText>
            <Switch
              value={included}
              onValueChange={onToggleIncluded}
              trackColor={{ false: colors.bgSecondary, true: colors.tealSoft }}
              thumbColor={included ? colors.teal : colors.subtle}
              ios_backgroundColor={colors.bgSecondary}
            />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function prettySource(source?: string): string {
  const s = (source ?? "").toLowerCase();
  if (s === "document_upload") return "Document";
  if (s === "manual_entry")    return "Manual entry";
  if (s === "wearable")        return "Wearable";
  if (s === "ai_guided")       return "AI";
  return "";
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },

  // Top row
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
    paddingTop: 1,
  },
  title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
    lineHeight: typescale.size.base * typescale.lineHeight.normal,
  },
  source: {
    fontSize: typescale.size.xs,
    color: colors.subtle,
    fontWeight: typescale.weight.medium,
  },
  date: {
    fontSize: typescale.size.xs,
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
    flexShrink: 0,
    paddingTop: 2,
  },

  // Summary
  summary: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingLeft: 34 + spacing.sm, // align with title
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xxs,
  },
  catPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  catText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },
  includeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  includeLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.subtle,
  },
  includeLabelActive: {
    color: colors.teal,
  },
});
