// src/screens/TimelineScreen.tsx
import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
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
  summary: string; // IMPORTANT: this is the column you actually have
  included_in_previsit: boolean;
};

type RenderRow =
  | { kind: "month"; key: string; label: string }
  | { kind: "event"; key: string; event: TimelineEventRow };

export function TimelineScreen({ navigation }: Props) {
  const [events, setEvents] = useState<TimelineEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // CHANGED: make load useCallback so we can call it from useFocusEffect safely
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

  // CHANGED: refresh every time this screen becomes active again (coming back from Details)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
                report={ev.summary} // IMPORTANT: summary is your column
                included={ev.included_in_previsit}
                onToggleIncluded={(next) => onToggleIncluded(ev.id, next)}
                onPress={() => navigation.navigate("Details", { id: ev.id })}
                onPressEdit={() => {}}
              />
            );
          })
        : null}

      {/* --- NEW DOCTOR NOTE SECTION REPLACING ACTION CARDS --- */}
      {(() => {
        const includedEvents = events.filter((e) => !!e.included_in_previsit);
        const preview = includedEvents.slice(0, 3);

        return (
          <>
            <SectionHeader
              title="Pre-Visit Note"
              subtitle={
                includedEvents.length === 0
                  ? "Nothing selected yet"
                  : `${includedEvents.length} item(s) selected`
              }
            />

            <View style={styles.noteCard}>
              <Text style={styles.noteTitle}>Doctor Note Draft</Text>
              <Text style={styles.noteMuted}>
                Toggle “Include in Pre-Visit Note” on timeline events. Everything
                you include shows up here.
              </Text>

              {includedEvents.length === 0 ? (
                <Text style={[styles.noteMuted, { marginTop: 10 }]}>
                  Select a few timeline items and come back. This will auto fill.
                </Text>
              ) : (
                <View style={{ gap: 6, marginTop: 12 }}>
                  {preview.map((e) => (
                    <View key={e.id} style={styles.noteRow}>
                      <View style={styles.noteDot} />
                      <Text style={styles.noteItemText} numberOfLines={1}>
                        {e.title ?? "(untitled)"}
                      </Text>
                    </View>
                  ))}

                  {includedEvents.length > preview.length ? (
                    <Text style={styles.noteMuted}>
                      + {includedEvents.length - preview.length} more
                    </Text>
                  ) : null}
                </View>
              )}

              <View style={{ marginTop: 16 }}>
                <Pressable
                  onPress={() => navigation.navigate("PreVisitNote")}
                  style={({ pressed }) => [
                    styles.noteButton,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.noteButtonText}>Open Pre-Visit Note</Text>
                </Pressable>
              </View>
            </View>
          </>
        );
      })()}
    </ScrollView>
  );
}

/* helpers stay the same */

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
  return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
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
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { paddingVertical: 20, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  muted: { fontSize: 12.5, color: colors.muted, textAlign: "center" },
  
  // Doctor Note Styles
  noteCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E6EEF5",
    shadowColor: "#0B1220",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  noteTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 4 },
  noteMuted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  noteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  noteItemText: { fontSize: 13, fontWeight: "600", color: colors.text, flex: 1 },
  noteButton: {
    backgroundColor: colors.teal,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  noteButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});