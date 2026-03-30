import React, { useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { supabase } from "../../lib/supabase";
import { captureException } from "../../lib/sentry";
import { TimelineCard, categoryMeta } from "../../components/ui/Timeline/TimelineCard";
import { MonthDivider } from "../../components/ui/Timeline/MonthDivider";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { spacing, radius, typescale, shadows } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
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

const PAGE_SIZE = 30;

export function TimelineScreen({ navigation }: Props) {
  const [events, setEvents]         = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);

  const styles = useStyles();
  const { colors } = useTheme();

  const load = useCallback(async (offset = 0, append = false) => {
    if (!append) setErr(null);
    try {
      const { data, error } = await supabase
        .from("timeline_events")
        .select(
          "id, occurred_at, date_precision, title, event_type, category, source, summary, included_in_previsit"
        )
        .neq("source", "apple_health")
        .order("occurred_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;

      const filtered = ((data ?? []) as TimelineEventRow[]).filter(
        (e) => e.source !== "apple_health"
      );

      setHasMore(filtered.length === PAGE_SIZE);

      if (append) {
        setEvents((prev) => [...prev, ...filtered]);
      } else {
        setEvents(filtered);
      }
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Failed to load timeline.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setHasMore(true); load(); }, [load]));

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    load(events.length, true);
  }, [loadingMore, hasMore, loading, events.length, load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setHasMore(true);
    load(0, false);
  }, [load]);

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

  const renderItem = useCallback(({ item: row }: { item: RenderRow }) => {
    if (row.kind === "month") {
      return <MonthDivider label={row.label} style={styles.monthDivider} />;
    }

    const ev   = row.event;
    const meta = categoryMeta(ev.category, colors);

    return (
      <View style={styles.spineRow}>
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
  }, [navigation, onToggleIncluded, styles, colors]);

  const listHeader = useMemo(() => (
    err ? (
      <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
        <ErrorBanner message="Couldn't load your timeline" onRetry={() => load()} />
      </View>
    ) : null
  ), [err, load]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} accessibilityLabel="Loading timeline" />
          <AppText style={styles.loadingText}>Loading your health timeline…</AppText>
        </View>
      );
    }
    if (!err) {
      return (
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
      );
    }
    return null;
  }, [loading, err, navigation, styles, colors]);

  const listFooter = useMemo(() => (
    <>
      {loadingMore ? (
        <View style={styles.loadMoreWrap}>
          <ActivityIndicator color={colors.teal} size="small" />
        </View>
      ) : null}

      {/* ── Pre-Visit Note panel ──────────────────────────── */}
      <View style={styles.preVisitCard}>
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

        {includedEvents.length === 0 ? (
          <AppText style={styles.preVisitInstruction}>
            Toggle "Pre-Visit" on any timeline event above to add it to your doctor note.
          </AppText>
        ) : (
          <View style={styles.preVisitItems}>
            {previewItems.map((e) => (
              <View key={e.id} style={styles.preVisitRow}>
                <View style={[styles.preVisitDot, { backgroundColor: categoryMeta(e.category, colors).dot }]} />
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
          accessible
          accessibilityRole="button"
          accessibilityLabel={includedEvents.length > 0 ? "View Pre-Visit Note" : "Open Pre-Visit Note"}
          onPress={() => navigation.navigate("PreVisitNote")}
          style={({ pressed }) => [styles.preVisitBtn, pressed && styles.preVisitBtnPressed]}
        >
          <AppText style={styles.preVisitBtnText}>
            {includedEvents.length > 0 ? "View Pre-Visit Note" : "Open Pre-Visit Note"}
          </AppText>
          <Ionicons name="chevron-forward" size={18} color={colors.teal} />
        </Pressable>
      </View>
    </>
  ), [loadingMore, includedEvents, previewItems, navigation, styles, colors]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.teal}
        />
      }
      ListHeaderComponent={listHeader}
      ListEmptyComponent={listEmpty}
      ListFooterComponent={listFooter}
    />
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

const useStyles = createStyles((c) => StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xxl + spacing.xl,
    flexGrow: 1,
  },
  loadMoreWrap: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },

  // Error
  errorBanner: {
    backgroundColor: c.dangerSoft,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontSize: typescale.size.sm,
    color: c.danger,
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
    color: c.muted,
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
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: typescale.size.sm,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  emptyBtn: {
    marginTop: spacing.xs,
    backgroundColor: c.teal,
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
    backgroundColor: c.borderLight,
    marginTop: 6,
    borderRadius: 1,
  },
  card: {
    flex: 1,
  },

  // Pre-Visit Note panel
  preVisitCard: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
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
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  preVisitTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  preVisitSub: {
    fontSize: typescale.size.xs,
    color: c.muted,
    marginTop: 2,
  },
  preVisitBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.teal,
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
    backgroundColor: c.borderLight,
    marginHorizontal: spacing.md,
  },

  // Instruction / items
  preVisitInstruction: {
    fontSize: typescale.size.sm,
    color: c.muted,
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
    color: c.textSub,
    fontWeight: typescale.weight.medium,
  },
  preVisitMore: {
    fontSize: typescale.size.xs,
    color: c.muted,
    marginLeft: 7 + spacing.sm,
  },

  // CTA button
  preVisitBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.teal,
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
}));
