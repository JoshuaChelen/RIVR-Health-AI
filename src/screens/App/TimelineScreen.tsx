// src/screens/TimelineScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { supabase } from "../../lib/supabase";
import { ActionCard } from "../../components/ui/Timeline/ActionCard";
import { TimelineCard } from "../../components/ui/Timeline/TimelineCard";
import { SectionHeader } from "../../components/ui/Timeline/SectionHeader";
import { MonthDivider } from "../../components/ui/Timeline/MonthDivider";
import { colors } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "Timeline">;

type DatePrecision = "day" | "month" | "year";

type TimelineEventRow = {
  id: string;
  occurred_at: string; // YYYY-MM-DD
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

export function TimelineScreen({ route }: Props) {
  const [events, setEvents] = useState<TimelineEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
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
  };

  useEffect(() => {
    load();
  }, []);

  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    let lastMonthKey: string | null = null;

    for (const ev of events) {
      const monthKey = monthBucketKey(ev.occurred_at, ev.date_precision);
      if (monthKey !== lastMonthKey) {
        out.push({
          kind: "month",
          key: `m-${monthKey}`,
          label: monthDividerLabel(ev.occurred_at, ev.date_precision),
        });
        lastMonthKey = monthKey;
      }

      out.push({ kind: "event", key: `e-${ev.id}`, event: ev });
    }

    return out;
  }, [events]);

  const onToggleIncluded = async (eventId: string, next: boolean) => {
    // optimistic UI
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, included_in_previsit: next } : e))
    );

    const { error } = await supabase
      .from("timeline_events")
      .update({ included_in_previsit: next })
      .eq("id", eventId);

    if (error) {
      // revert if failed
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, included_in_previsit: !next } : e
        )
      );
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <SectionHeader title="Health Timeline" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.muted}>Loading timeline...</Text>
        </View>
      ) : null}

      {err ? (
        <Text style={[styles.muted, { color: colors.danger }]}>{err}</Text>
      ) : null}

      {!loading && !err && rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No timeline events yet</Text>
          <Text style={styles.muted}>
            Upload a document or add a manual entry to get started.
          </Text>
        </View>
      ) : null}

      {!loading && !err
        ? rows.map((row) => {
            if (row.kind === "month") {
              return <MonthDivider key={row.key} label={row.label} />;
            }

            const ev = row.event;
            const pillTone = categoryToTone(ev.category);
            const sourceLabel = sourceToLabel(ev.source);
            const icon = categoryToIcon(ev.category);

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
                onPressEdit={() => {
                  // later: open edit modal or navigate to a detail screen
                }}
              />
            );
          })
        : null}

      <SectionHeader title="Action Needed" />

      <View style={styles.actionGrid}>
        <ActionCard
          title="Add Recent Lab Results"
          description="You mentioned getting labs done last week..."
          badgeText="Priority"
          icon={<Text>⬇️</Text>}
          ctaLabel="Add Labs"
          onPress={() => {}}
          // Keep accents calmer. Use teal for both, or remove accents later if you want.
          accentColor={colors.teal}
          containerStyle={styles.card}
        />

        <ActionCard
          title="Sleep Quality Improvement"
          description="Your wearable showed better sleep this week..."
          badgeText="Priority"
          icon={<Text>🌙</Text>}
          ctaLabel="Add Sleep Data"
          onPress={() => {}}
          accentColor={colors.teal}
          containerStyle={styles.card}
        />
      </View>
    </ScrollView>
  );
}

/* ---------------- helpers ---------------- */

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1);
}

function monthBucketKey(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;

  if (precision === "year") return `${y}`;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthDividerLabel(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);

  if (precision === "year") return `${dt.getFullYear()}`;

  // Month Year
  return dt.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatEventDate(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);

  if (precision === "year") return `${dt.getFullYear()}`;

  if (precision === "month") {
    return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  return dt.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function categoryToTone(category: string): "green" | "gray" | "pink" | "blue" {
  const c = category.toLowerCase();
  if (c.includes("vital") || c.includes("lab")) return "green";
  if (c.includes("med")) return "blue";
  if (c.includes("life")) return "pink";
  return "gray";
}

function sourceToLabel(source: string) {
  const s = source.toLowerCase();
  if (s === "document_upload") return "Document Upload";
  if (s === "manual_entry") return "Manual Entry";
  if (s === "wearable") return "Wearable";
  if (s === "ai_guided") return "AI Guided";
  return "Source";
}

function categoryToIcon(category: string) {
  const c = category.toLowerCase();

  if (c.includes("med")) {
    return <Text style={{ color: "#0369A1", fontWeight: "900" }}>⚕</Text>;
  }
  if (c.includes("vital") || c.includes("lab")) {
    return <Text style={{ color: "#15803D", fontWeight: "900" }}>∿</Text>;
  }
  if (c.includes("life")) {
    return <Text style={{ color: "#BE185D", fontWeight: "900" }}>♥</Text>;
  }

  return <Text style={{ fontWeight: "900", color: "#B45309" }}>∿</Text>;
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  center: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  muted: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: "center",
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
