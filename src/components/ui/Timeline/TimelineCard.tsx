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
import { radius, shadows, spacing, typescale } from "../../../theme/tokens";
import type { Colors } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

// ─── Category config ──────────────────────────────────────────────────────────

type CategoryMeta = {
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  pillBg: string;
  pillText: string;
  dot: string;
};

function defaultMeta(col: Colors): CategoryMeta {
  return {
    iconName: "fitness-outline",
    iconColor: col.orange,
    iconBg: col.orangeSoft,
    pillBg: col.orangeSoft,
    pillText: col.orange,
    dot: col.orange,
  };
}

function buildCategoryMap(col: Colors): { test: (c: string) => boolean; meta: CategoryMeta }[] {
  return [
    {
      test: (c) => c.includes("med"),
      meta: {
        iconName: "medkit-outline",
        iconColor:  "#075985",
        iconBg:     col.blueSoft,
        pillBg:     col.blueSoft,
        pillText:   "#075985",
        dot:        col.blue,
      },
    },
    {
      test: (c) => c.includes("vital") || c.includes("lab"),
      meta: {
        iconName:   "pulse-outline",
        iconColor:  col.green,
        iconBg:     col.greenSoft,
        pillBg:     col.greenSoft,
        pillText:   col.green,
        dot:        col.green,
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
      test: (c) =>
        c.includes("activity") ||
        c.includes("step") ||
        c.includes("walk") ||
        c.includes("run") ||
        c.includes("energy") ||
        c.includes("exercise"),
      meta: {
        iconName: "fitness-outline",
        iconColor: col.orange,
        iconBg: col.orangeSoft,
        pillBg: col.orangeSoft,
        pillText: col.orange,
        dot: col.orange,
      },
    },
    {
      test: (c) => c.includes("visit") || c.includes("appoint"),
      meta: {
        iconName: "calendar-outline",
        iconColor:  col.teal,
        iconBg:     col.tealSoft,
        pillBg:     col.tealSoft,
        pillText:   col.teal,
        dot:        col.teal,
      },
    },
  ];
}

export function categoryMeta(category: string, col: Colors): CategoryMeta {
  const c = (category ?? "").toLowerCase();
  return buildCategoryMap(col).find((m) => m.test(c))?.meta ?? defaultMeta(col);
}

// ─── Props ────────────────────────────────────────────────────────────────────

type TimelineCardProps = {
  title: string;
  dateLabel: string;
  dateSubLabel?: string | null;
  category: string;
  source?: string;
  summary: string;
  clinicalTags?: { label: string; value: string }[];
  included: boolean;
  onToggleIncluded: (next: boolean) => void;
  onPress?: () => void;
  /**
   * When provided, the card replaces the static `dateLabel` slot with a
   * tappable "Set date" CTA. Used for events whose occurred_at is null.
   */
  onSetDate?: () => void;
  style?: StyleProp<ViewStyle>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TimelineCard({
  title,
  dateLabel,
  dateSubLabel,
  category,
  source,
  summary,
  clinicalTags = [],
  included,
  onToggleIncluded,
  onPress,
  onSetDate,
  style,
}: TimelineCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const meta = categoryMeta(category, colors);
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn  = () =>
    Animated.spring(scale, { toValue: 0.985, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 25 }).start();

  const sourceLabel = prettySource(source);
  const cleanCategory = (category ?? "").trim() || "Other";

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <View style={styles.card}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${dateLabel}, ${cleanCategory}`}
          accessibilityHint="Opens event details"
          onPress={onPress}
          onPressIn={onPress ? onPressIn : undefined}
          onPressOut={onPress ? onPressOut : undefined}
          disabled={!onPress}
          style={styles.pressArea}
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

            {onSetDate ? (
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Set visit date"
                onPress={onSetDate}
                hitSlop={6}
                style={({ pressed }) => [styles.setDateBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.teal} />
                <AppText style={styles.setDateBtnText}>Set date</AppText>
              </Pressable>
            ) : (
              <View style={styles.dateBlock}>
                <AppText style={styles.date}>{dateLabel}</AppText>
                {dateSubLabel ? (
                  <AppText style={styles.dateSub}>{dateSubLabel}</AppText>
                ) : null}
              </View>
            )}
          </View>

          {/* ── Summary ── */}
          {summary?.trim() ? (
            <AppText style={styles.summary} numberOfLines={3}>
              {summary.trim()}
            </AppText>
          ) : null}

          {clinicalTags.length > 0 ? (
            <View style={styles.clinicalTags}>
              {clinicalTags.map((tag) => (
                <View key={`${tag.label}:${tag.value}`} style={styles.clinicalTag}>
                  <AppText style={styles.clinicalTagLabel}>{tag.label}</AppText>
                  <AppText style={styles.clinicalTagValue}>{tag.value}</AppText>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>

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
              accessible
              accessibilityLabel="Include in pre-visit note"
              accessibilityRole="switch"
              accessibilityState={{ checked: included }}
              value={included}
              onValueChange={onToggleIncluded}
              trackColor={{ false: colors.bgSecondary, true: colors.tealSoft }}
              thumbColor={included ? colors.teal : colors.subtle}
              ios_backgroundColor={colors.bgSecondary}
            />
          </View>
        </View>
      </View>
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

const useStyles = createStyles((c) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
    ...shadows.card,
  },
  pressArea: {
    padding: spacing.md,
    gap: spacing.xs,
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
    color: c.text,
    lineHeight: typescale.size.base * typescale.lineHeight.normal,
  },
  source: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    fontWeight: typescale.weight.medium,
  },
  date: {
    fontSize: typescale.size.xs,
    color: c.teal,
    fontWeight: typescale.weight.semibold,
    textAlign: "right",
  },
  dateBlock: {
    flexShrink: 0,
    paddingTop: 2,
    maxWidth: 132,
    alignItems: "flex-end",
  },
  dateSub: {
    marginTop: 2,
    fontSize: typescale.size.xs,
    color: c.subtle,
    fontWeight: typescale.weight.medium,
    textAlign: "right",
  },
  setDateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: c.tealSoft,
    borderWidth: 1,
    borderColor: c.tealBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 0,
  },
  setDateBtnText: {
    fontSize: typescale.size.xs,
    color: c.teal,
    fontWeight: typescale.weight.bold,
  },

  // Summary
  summary: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingLeft: 34 + spacing.sm, // align with title
  },
  clinicalTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingLeft: 34 + spacing.sm,
    paddingTop: spacing.xs,
  },
  clinicalTag: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bgSecondary,
    overflow: "hidden",
  },
  clinicalTagLabel: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
  },
  clinicalTagValue: {
    paddingRight: 8,
    paddingVertical: 3,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.text,
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
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
    color: c.subtle,
  },
  includeLabelActive: {
    color: c.teal,
  },
}));
