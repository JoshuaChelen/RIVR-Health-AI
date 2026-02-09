import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator, Switch, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "Details">;

type TimelineEventRow = {
  id: string;
  occurred_at?: string | null;
  date_precision?: "day" | "month" | "year" | null;
  title?: string | null;
  event_type?: string | null;
  category?: string | null;
  source?: string | null;
  summary?: string | null;
  included_in_previsit?: boolean | null;
  tags?: string[] | null;
  data?: any;
};

export function TimelineEventDetailsScreen({ route, navigation }: Props) {
  const id = route.params?.id;

  const [item, setItem] = useState<TimelineEventRow | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setBusy(false);
      setErr("Missing timeline item id.");
      return;
    }

    (async () => {
      setBusy(true);
      setErr(null);

      try {
        const { data, error } = await supabase
          .from("timeline_events")
          .select("*")
          .eq("id", id)
          .single();

        if (error) throw error;

        setItem(data as TimelineEventRow);

        const t = (data?.title ?? "Timeline").toString();
        navigation.setOptions({ title: t.length > 26 ? "Details" : t });
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load details.");
      } finally {
        setBusy(false);
      }
    })();
  }, [id, navigation]);

  const included = !!item?.included_in_previsit;

  const headerMeta = useMemo(() => {
    if (!item) return "";
    const parts = [
      formatDate(item.occurred_at, item.date_precision ?? undefined),
      prettySource(item.source),
      pretty(item.category),
    ].filter(Boolean);
    return parts.join("  •  ");
  }, [item]);

  const onToggleIncluded = async (next: boolean) => {
    if (!item) return;

    setItem({ ...item, included_in_previsit: next });
    setSaving(true);

    const { error } = await supabase
      .from("timeline_events")
      .update({ included_in_previsit: next })
      .eq("id", item.id);

    if (error) {
      setItem({ ...item, included_in_previsit: !next });
      setErr(error.message);
    }

    setSaving(false);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {busy ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
            <AppText variant="muted">Loading...</AppText>
          </View>
        ) : null}

        {err ? (
          <Card style={styles.errorCard}>
            <AppText variant="caption" style={{ color: colors.danger, fontWeight: "800" }}>
              {err}
            </AppText>
          </Card>
        ) : null}

        {!busy && item ? (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.iconChip}>
                <AppText style={styles.iconChipText}>{iconForCategory(item.category)}</AppText>
              </View>

              <AppText variant="h1" style={styles.title}>
                {item.title ?? "Untitled"}
              </AppText>

              <AppText variant="muted" style={styles.meta}>
                {headerMeta}
              </AppText>

              <View style={styles.pillsRow}>
                <Pill label={pretty(item.category)} tone={toneForCategory(item.category)} />
                <Pill label={prettySource(item.source)} tone="gray" />
                {item.event_type ? <Pill label={item.event_type} tone="blue" /> : null}
              </View>
            </View>

            {/* Summary */}
            <Card style={styles.card}>
              <AppText variant="caption" style={styles.sectionLabel}>
                Summary
              </AppText>
              <AppText style={styles.bodyText}>
                {item.summary?.trim() || "No summary provided yet."}
              </AppText>
            </Card>

            {/* Details */}
            <Card style={styles.card}>
              <AppText variant="caption" style={styles.sectionLabel}>
                Details
              </AppText>

              <InfoRow label="Date" value={formatDate(item.occurred_at, item.date_precision ?? undefined)} />
              <InfoRow label="Category" value={pretty(item.category)} />
              <InfoRow label="Source" value={prettySource(item.source)} />
              <InfoRow label="Event Type" value={item.event_type ?? "Unknown"} />
              <InfoRow label="Included in Pre-Visit Note" value={included ? "Yes" : "No"} />

              <View style={styles.divider} />

              <View style={styles.toggleRow}>
                <AppText style={styles.toggleLabel}>Include in Pre-Visit Note</AppText>
                <Switch
                  value={included}
                  onValueChange={onToggleIncluded}
                  disabled={saving}
                />
              </View>

              {saving ? (
                <AppText variant="caption" style={{ color: colors.muted }}>
                  Saving...
                </AppText>
              ) : null}
            </Card>

            {/* Tags */}
            <Card style={styles.card}>
              <AppText variant="caption" style={styles.sectionLabel}>
                Tags
              </AppText>

              <View style={styles.tagsWrap}>
                {(item.tags ?? []).length ? (
                  (item.tags ?? []).map((t) => <TagChip key={t} label={t} />)
                ) : (
                  <AppText variant="muted">No tags.</AppText>
                )}
              </View>
            </Card>

            {/* Data */}
            <Card style={styles.card}>
              <View style={styles.dataHeader}>
                <AppText variant="caption" style={styles.sectionLabel}>
                  Data
                </AppText>
                <AppText variant="caption" style={{ color: colors.muted }}>
                  Raw output
                </AppText>
              </View>

              {item.data ? (
                <JsonBlock value={item.data} />
              ) : (
                <AppText variant="muted">No structured data.</AppText>
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" style={styles.infoLabel}>
        {label}
      </AppText>
      <AppText style={styles.infoValue}>{value}</AppText>
    </View>
  );
}

function TagChip({ label }: { label: string }) {
  return (
    <View style={styles.tagChip}>
      <AppText variant="caption" style={styles.tagText}>
        {label}
      </AppText>
    </View>
  );
}

type PillTone = "green" | "gray" | "pink" | "blue";

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const st = pillToneStyles[tone];
  return (
    <View style={[styles.pill, st.container]}>
      <AppText variant="caption" style={[styles.pillText, st.text]}>
        {label}
      </AppText>
    </View>
  );
}

function JsonBlock({ value }: { value: any }) {
  const [expanded, setExpanded] = useState(false);

  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <View style={styles.jsonWrap}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.jsonToggle}>
        <AppText variant="caption" style={styles.jsonToggleText}>
          {expanded ? "Hide" : "Show"}
        </AppText>
      </Pressable>

      {expanded ? (
        <AppText style={styles.jsonText}>{text}</AppText>
      ) : (
        <AppText variant="muted">Tap Show to view structured data.</AppText>
      )}
    </View>
  );
}

const pillToneStyles: Record<PillTone, { container: any; text: any }> = {
  green: { container: { backgroundColor: "#E7F7EF", borderColor: "#BEEAD3" }, text: { color: "#0F7A4A" } },
  gray: { container: { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" }, text: { color: "#475569" } },
  pink: { container: { backgroundColor: "#FCE7F3", borderColor: "#FBCFE8" }, text: { color: "#9D174D" } },
  blue: { container: { backgroundColor: "#E0F2FE", borderColor: "#BAE6FD" }, text: { color: "#075985" } },
};

function pretty(x?: string | null) {
  return (x ?? "").trim() || "Unknown";
}
function prettySource(x?: string | null) {
  const s = (x ?? "").toLowerCase();
  if (s === "document_upload") return "Document Upload";
  if (s === "manual_entry") return "Manual Entry";
  if (s === "wearable") return "Wearable";
  if (s === "ai_guided") return "AI Guided";
  return (x ?? "").trim() || "Source";
}
function formatDate(ymd?: string | null, precision?: "day" | "month" | "year") {
  if (!ymd) return "No date";
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const dt = new Date(y, (m || 1) - 1, d || 1);

  if (precision === "year") return `${dt.getFullYear()}`;
  if (precision === "month") return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return dt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
function toneForCategory(category?: string | null): PillTone {
  const c = (category ?? "").toLowerCase();
  if (c.includes("vital")) return "green";
  if (c.includes("lifestyle")) return "pink";
  if (c.includes("med")) return "blue";
  return "gray";
}
function iconForCategory(category?: string | null) {
  const c = (category ?? "").toLowerCase();
  if (c.includes("vital")) return "∿";
  if (c.includes("lifestyle")) return "♥";
  if (c.includes("med")) return "⚕";
  return "•";
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { paddingVertical: 30, alignItems: "center", gap: 10 },

  header: { gap: 8, paddingBottom: 4 },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconChipText: { fontWeight: "900", color: colors.teal },

  title: { color: colors.text },
  meta: { textAlign: "left" },

  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  card: { gap: 12 },
  errorCard: { borderWidth: 1, borderColor: colors.danger },

  sectionLabel: { color: colors.muted, fontWeight: "900" },
  bodyText: { color: colors.text, lineHeight: 18 },

  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  infoLabel: { color: colors.muted, fontWeight: "800" },
  infoValue: { color: colors.text, fontWeight: "700", textAlign: "right", flex: 1 },

  divider: { height: 1, backgroundColor: colors.border },

  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontWeight: "800", color: colors.teal },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillText: { fontWeight: "800" },

  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tagText: { fontWeight: "800", color: "#475569" },

  dataHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  jsonWrap: { gap: 8 },
  jsonToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFFFFF",
  },
  jsonToggleText: { fontWeight: "900", color: colors.teal },
  jsonText: { fontFamily: "Menlo", fontSize: 12, lineHeight: 16, color: colors.text },
});
