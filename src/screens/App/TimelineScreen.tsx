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
import { ActionCard } from "../../components/ui/Timeline/ActionCard";
import { TimelineCard } from "../../components/ui/Timeline/TimelineCard";
import { SectionHeader } from "../../components/ui/Timeline/SectionHeader";
import { MonthDivider } from "../../components/ui/Timeline/MonthDivider";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, spacing, radius, typescale } from "../../theme/tokens";

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
  | { kind: "event"; key: string; event: TimelineEventRow };

export function TimelineScreen({ navigation }: Props) {
  const [events, setEvents]       = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("timeline_events")
        .select(
          "id, occurred_at, date_precision, title, event_type, category, source, summary, included_in_previsit"
        )
        .order("occurred_at", { ascending: false });

      if (error) throw error;
      setEvents((data ?? []) as TimelineEventRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load timeline.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => { load(); }, [load])
  );

  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    let lastMonthKey: string | null = null;

    for (const ev of events) {
      const monthKey = monthBucketKey(ev.occurred_at, ev.date_precision);
      if (monthKey !== lastMonthKey) {
        out.push({ kind: "month", key: `m-${monthKey}`, label: monthDividerLabel(ev.occurred_at, ev.date_precision) });
        lastMonthKey = monthKey;
      }
      out.push({ kind: "event", key: `e-${ev.id}`, event: ev });
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
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.teal}
        />
      }
    >
      <SectionHeader title="Health Timeline" />

      {/* Loading */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
          <AppText variant="caption" style={{ marginTop: 8 }}>Loading timeline…</AppText>
        </View>
      ) : null}

      {/* Error */}
      {err ? (
        <AppText variant="caption" style={{ color: colors.danger, textAlign: "center" }}>
          {err}
        </AppText>
      ) : null}

      {/* Empty state */}
      {!loading && !err && rows.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="title" style={styles.emptyTitle}>No timeline events yet</AppText>
          <AppText variant="muted" style={styles.emptyBody}>
            Upload a document and process it to populate your timeline.
          </AppText>
        </View>
      ) : null}

      {/* Events */}
      {!loading && !err
        ? rows.map((row) => {
            if (row.kind === "month") {
              return <MonthDivider key={row.key} label={row.label} />;
            }

            const ev         = row.event;
            const pillTone   = categoryToTone(ev.category);
            const sourceLabel = sourceToLabel(ev.source);
            const icon       = categoryToIcon(ev.category);

            return (
              <TimelineCard
                key={row.key}
                categoryPill={{ label: ev.category, tone: pillTone }}
                sourcePill={{ label: sourceLabel, tone: "gray" }}
                leadingIcon={icon}
                title={ev.title}
                dateLabel={formatEventDate(ev.occurred_at, ev.date_precision)}
                report={ev.summary}
                included={ev.included_in_previsit}
                onToggleIncluded={(next) => onToggleIncluded(ev.id, next)}
                onPress={() => navigation.navigate("Details", { id: ev.id })}
              />
            );
          })
        : null}

      {/* Pre-Visit Note panel */}
      <SectionHeader
        title="Pre-Visit Note"
        subtitle={
          includedEvents.length === 0
            ? "Nothing selected yet"
            : `${includedEvents.length} item${includedEvents.length === 1 ? "" : "s"} selected`
        }
      />

      <View style={styles.noteCard}>
        <AppText variant="title" style={styles.noteTitle}>Doctor Note Draft</AppText>
        <AppText variant="muted" style={styles.noteBody}>
          Toggle "Include in Pre-Visit Note" on timeline events above. They'll appear here automatically.
        </AppText>

        {includedEvents.length > 0 ? (
          <View style={styles.noteItems}>
            {previewItems.map((e) => (
              <View key={e.id} style={styles.noteRow}>
                <View style={styles.noteDot} />
                <AppText variant="body" style={styles.noteItemText} numberOfLines={1}>
                  {e.title ?? "(untitled)"}
                </AppText>
              </View>
            ))}
            {includedEvents.length > previewItems.length ? (
              <AppText variant="caption" style={{ marginTop: 2 }}>
                +{includedEvents.length - previewItems.length} more
              </AppText>
            ) : null}
          </View>
        ) : null}

        <Pressable
          onPress={() => navigation.navigate("PreVisitNote")}
          style={({ pressed }) => [styles.noteBtn, pressed && { opacity: 0.85 }]}
        >
          <AppText style={styles.noteBtnText}>Open Pre-Visit Note</AppText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  return dt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function categoryToTone(category: string): "green" | "gray" | "pink" | "blue" {
  const c = category.toLowerCase();
  if (c.includes("vital") || c.includes("lab")) return "green";
  if (c.includes("med"))                         return "blue";
  if (c.includes("life"))                        return "pink";
  return "gray";
}

function sourceToLabel(source: string) {
  const s = source.toLowerCase();
  if (s === "document_upload") return "Document";
  if (s === "manual_entry")    return "Manual";
  if (s === "wearable")        return "Wearable";
  if (s === "ai_guided")       return "AI";
  return "Source";
}

function categoryToIcon(category: string) {
  const c = category.toLowerCase();
  if (c.includes("med"))                        return <AppText style={{ color: "#0369A1", fontWeight: typescale.weight.black }}>⚕</AppText>;
  if (c.includes("vital") || c.includes("lab")) return <AppText style={{ color: colors.green, fontWeight: typescale.weight.black }}>∿</AppText>;
  if (c.includes("life"))                       return <AppText style={{ color: "#BE185D", fontWeight: typescale.weight.black }}>♥</AppText>;
  return <AppText style={{ color: colors.orange, fontWeight: typescale.weight.black }}>∿</AppText>;
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 48,
    gap: spacing.sm,
  },
  center: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: 8,
  },
  empty: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    textAlign: "center",
  },
  emptyBody: {
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Pre-visit note card
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    shadowColor: "#0B1220",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  noteTitle: {
    color: colors.text,
    marginBottom: 2,
  },
  noteBody: {
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  noteItems: {
    gap: 6,
    marginTop: 4,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },
  noteItemText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: colors.text,
  },
  noteBtn: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  noteBtnText: {
    color: "#fff",
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.base,
  },
});
