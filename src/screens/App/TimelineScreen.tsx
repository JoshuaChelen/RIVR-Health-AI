import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { supabase } from "../../lib/supabase";
import { TimelineCard, categoryMeta } from "../../components/ui/Timeline/TimelineCard";
import { MonthDivider } from "../../components/ui/Timeline/MonthDivider";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";
import Ionicons from "@expo/vector-icons/Ionicons";

type Props = NativeStackScreenProps<AppStackParamList, "Timeline">;

type DatePrecision = "day" | "month" | "year";

type TimelineEventRow = {
  id: string;
  occurred_at: string;
  date_precision: DatePrecision;
  title: string;
  event_type: string;
  category: string;
  source: string;
  summary: string;
  included_in_previsit: boolean;
};

type RenderRow =
  | { kind: "month"; key: string; label: string }
  | { kind: "event"; key: string; event: TimelineEventRow; isLastInGroup: boolean };

export function TimelineScreen({ navigation }: Props) {
  const [events, setEvents]         = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
        const { data, error } = await supabase
      .from("timeline_events")
      .select(
        "id, occurred_at, date_precision, title, event_type, category, source, summary, included_in_previsit"
      )
      .neq("source", "apple_health")
      .order("occurred_at", { ascending: false });

    if (error) throw error;
    setEvents(
      ((data ?? []) as TimelineEventRow[]).filter(
        (e) => e.source !== "apple_health"
      )
    );
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load timeline.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    let lastMonthKey: string | null = null;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const monthKey = monthBucketKey(ev.occurred_at, ev.date_precision);
      if (monthKey !== lastMonthKey) {
        out.push({ kind: "month", key: `m-${monthKey}`, label: monthDividerLabel(ev.occurred_at, ev.date_precision) });
        lastMonthKey = monthKey;
      }

      // isLastInGroup = next row is a month divider or we're at the end
      const next = events[i + 1];
      const isLastInGroup = !next || monthBucketKey(next.occurred_at, next.date_precision) !== monthKey;

      out.push({ kind: "event", key: `e-${ev.id}`, event: ev, isLastInGroup });
    }

    return out;
  }, [events]);

  const onToggleIncluded = async (eventId: string, next: boolean) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, included_in_previsit: next } : e))
    );
    const { error } = await supabase
      .from("timeline_events")
      .update({ included_in_previsit: next })
      .eq("id", eventId);
    if (error) {
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, included_in_previsit: !next } : e))
      );
    }
  };

  const includedEvents = events.filter((e) => !!e.included_in_previsit);
  const previewItems   = includedEvents.slice(0, 3);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.teal}
        />
      }
    >
      {/* ── Error banner ─────────────────────────────────── */}
      {err ? (
        <View style={styles.errorBanner}>
          <AppText style={styles.errorText}>{err}</AppText>
        </View>
      ) : null}

      {/* ── Loading ───────────────────────────────────────── */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} />
          <AppText style={styles.loadingText}>Loading your health timeline…</AppText>
        </View>
      ) : null}

      {/* ── Empty state ───────────────────────────────────── */}
      {!loading && !err && rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="clipboard-outline" size={24} color={colors.teal} />
          </View>
          <AppText style={styles.emptyTitle}>Your timeline is empty</AppText>
          <AppText style={styles.emptyBody}>
            Upload medical documents and process them.{"\n"}Your health history will appear here.
          </AppText>
          <Pressable
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
            onPress={() => navigation.navigate("ManageDocuments")}
          >
            <AppText style={styles.emptyBtnText}>Upload documents</AppText>
          </Pressable>
        </View>
      ) : null}

      {/* ── Timeline rows with spine ──────────────────────── */}
      {!loading && !err && rows.length > 0 ? (
        <View style={styles.timelineWrap}>
          {rows.map((row) => {
            if (row.kind === "month") {
              return (
                <MonthDivider
                  key={row.key}
                  label={row.label}
                  style={styles.monthDivider}
                />
              );
            }

            const ev   = row.event;
            const meta = categoryMeta(ev.category);

            return (
              <View key={row.key} style={styles.spineRow}>
                {/* Left spine: dot + optional connecting line */}
                <View style={styles.spineGutter}>
                  <View
                    style={[
                      styles.spineMarker,
                      { backgroundColor: `${meta.dot}14`, borderColor: `${meta.dot}40` },
                    ]}
                  >
                    <View style={[styles.spineMarkerInner, { backgroundColor: meta.dot }]} />
                  </View>

                  {!row.isLastInGroup ? <View style={styles.spineLine} /> : null}
                </View>

                {/* Card */}
                <TimelineCard
                  title={ev.title}
                  dateLabel={formatEventDate(ev.occurred_at, ev.date_precision)}
                  category={ev.category}
                  source={ev.source}
                  summary={ev.summary}
                  included={ev.included_in_previsit}
                  onToggleIncluded={(next) => onToggleIncluded(ev.id, next)}
                  onPress={() => navigation.navigate("Details", { id: ev.id })}
                  style={styles.card}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {/* ── Pre-Visit Note panel ──────────────────────────── */}
      <View style={styles.preVisitCard}>
        {/* Header */}
        <View style={styles.preVisitHeader}>
          <View style={styles.preVisitIconWrap}>
            <Ionicons name="medkit-outline" size={20} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={styles.preVisitTitle}>Pre-Visit Note</AppText>
            <AppText style={styles.preVisitSub}>
              {includedEvents.length === 0
                ? "No events selected yet"
                : `${includedEvents.length} event${includedEvents.length === 1 ? "" : "s"} selected`}
            </AppText>
          </View>
          {includedEvents.length > 0 ? (
            <View style={styles.preVisitBadge}>
              <AppText style={styles.preVisitBadgeText}>{includedEvents.length}</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.preVisitDivider} />

        {/* Instruction or preview items */}
        {includedEvents.length === 0 ? (
          <AppText style={styles.preVisitInstruction}>
            Toggle "Pre-Visit" on any timeline event above to add it to your doctor note.
          </AppText>
        ) : (
          <View style={styles.preVisitItems}>
            {previewItems.map((e) => (
              <View key={e.id} style={styles.preVisitRow}>
                <View style={[styles.preVisitDot, { backgroundColor: categoryMeta(e.category).dot }]} />
                <AppText style={styles.preVisitItemText} numberOfLines={1}>{e.title}</AppText>
              </View>
            ))}
            {includedEvents.length > previewItems.length ? (
              <AppText style={styles.preVisitMore}>
                +{includedEvents.length - previewItems.length} more event{includedEvents.length - previewItems.length === 1 ? "" : "s"}
              </AppText>
            ) : null}
          </View>
        )}

        <Pressable
          onPress={() => navigation.navigate("PreVisitNote")}
          style={({ pressed }) => [styles.preVisitBtn, pressed && styles.preVisitBtnPressed]}
        >
          <AppText style={styles.preVisitBtnText}>
            {includedEvents.length > 0 ? "View Pre-Visit Note" : "Open Pre-Visit Note"}
          </AppText>
          <Ionicons name="chevron-forward" size={18} color={colors.teal} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function monthBucketKey(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);
  if (precision === "year") return `${dt.getFullYear()}`;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function monthDividerLabel(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);
  if (precision === "year") return `${dt.getFullYear()}`;
  return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatEventDate(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);
  if (precision === "year")  return `${dt.getFullYear()}`;
  if (precision === "month") return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GUTTER_WIDTH   = 32;
const MARKER_SIZE    = 16;
const MARKER_INNER   = 6;
const DOT_MARGIN_TOP = 11;

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xxl + spacing.xl,
  },

  // Error
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium,
  },

  // Loading
  loadingWrap: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typescale.size.sm,
    color: colors.muted,
  },

  // Empty
  emptyWrap: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  emptyBtn: {
    marginTop: spacing.xs,
    backgroundColor: colors.teal,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    ...shadows.xs,
  },
  emptyBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: "#fff",
  },

  // Timeline wrapper
  timelineWrap: {
    paddingTop: spacing.xs,
  },

  // Month divider spacing
  monthDivider: {
    paddingHorizontal: spacing.lg,
  },

  // Spine row layout
  spineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    marginBottom: spacing.sm,
  },
  spineGutter: {
    width: GUTTER_WIDTH,
    alignItems: "center",
    paddingTop: DOT_MARGIN_TOP,
  },

  spineMarker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  spineMarkerInner: {
    width: MARKER_INNER,
    height: MARKER_INNER,
    borderRadius: MARKER_INNER / 2,
  },

  spineLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.borderLight,
    marginTop: 6,
    borderRadius: 1,
  },
  card: {
    flex: 1,
  },

  // Pre-Visit Note panel
  preVisitCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  preVisitHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.sm,
  },
  preVisitIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  preVisitTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  preVisitSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    marginTop: 2,
  },
  preVisitBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  preVisitBadgeText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.black,
    color: "#fff",
    lineHeight: 16,
  },
  preVisitDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginHorizontal: spacing.md,
  },

  // Instruction / items
  preVisitInstruction: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    padding: spacing.md,
    paddingTop: spacing.sm,
  },
  preVisitItems: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  preVisitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  preVisitDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  preVisitItemText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: colors.textSub,
    fontWeight: typescale.weight.medium,
  },
  preVisitMore: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    marginLeft: 7 + spacing.sm,
  },

  // CTA button
  preVisitBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.teal,
    margin: spacing.md,
    marginTop: spacing.xs,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
  },
  preVisitBtnPressed: {
    opacity: 0.87,
    transform: [{ scale: 0.985 }],
  },
  preVisitBtnText: {
    flex: 1,
    color: "#fff",
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.base,
    textAlign: "center",
  },
});
