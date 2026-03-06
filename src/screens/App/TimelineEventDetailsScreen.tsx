import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, radius, spacing, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "Details">;

type TimelineEventRow = {
  id: string;
  occurred_at?: string | null; // YYYY-MM-DD
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

type Draft = {
  title: string;
  summary: string;
  occurred_at: string; // YYYY-MM-DD
  date_precision: "day" | "month" | "year";
  category: string;
  event_type: string;
  tagsCsv: string;
};

export function TimelineEventDetailsScreen({ route, navigation }: Props) {
  const id = route.params?.id;

  const [item, setItem] = useState<TimelineEventRow | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

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

        const row = data as TimelineEventRow;
        setItem(row);

        // Build initial draft from DB values
        setDraft({
          title: (row.title ?? "").toString(),
          summary: (row.summary ?? "").toString(),
          occurred_at: (row.occurred_at ?? "").toString(), // expect YYYY-MM-DD
          date_precision: (row.date_precision ?? "day") as "day" | "month" | "year",
          category: (row.category ?? "").toString(),
          event_type: (row.event_type ?? "").toString(),
          tagsCsv: Array.isArray(row.tags) ? row.tags.join(", ") : "",
        });

        const t = (row?.title ?? "Details").toString();
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

    // optimistic UI
    setItem({ ...item, included_in_previsit: next });
    setSaving(true);
    setErr(null);

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

  const cancelEdit = () => {
    if (!item) return;

    setDraft({
      title: (item.title ?? "").toString(),
      summary: (item.summary ?? "").toString(),
      occurred_at: (item.occurred_at ?? "").toString(),
      date_precision: (item.date_precision ?? "day") as "day" | "month" | "year",
      category: (item.category ?? "").toString(),
      event_type: (item.event_type ?? "").toString(),
      tagsCsv: Array.isArray(item.tags) ? item.tags.join(", ") : "",
    });
    setEditing(false);
    setErr(null);
  };

  const saveEdit = async () => {
    if (!item || !draft) return;

    setErr(null);

    // very basic date validation if they edit it
    if (draft.occurred_at.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(draft.occurred_at.trim())) {
      setErr("Date must be in YYYY-MM-DD format.");
      return;
    }

    const tags = draft.tagsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const payload: Partial<TimelineEventRow> = {
      title: draft.title.trim() || null,
      summary: draft.summary.trim() || null,
      occurred_at: draft.occurred_at.trim() || null,
      date_precision: draft.date_precision,
      category: draft.category.trim() || null,
      event_type: draft.event_type.trim() || null,
      tags,
    };

    try {
      setSaving(true);

      const { data, error } = await supabase
        .from("timeline_events")
        .update(payload)
        .eq("id", item.id)
        .select("*")
        .single();

      if (error) throw error;

      const updated = data as TimelineEventRow;
      setItem(updated);

      // keep draft synced + exit editing
      setDraft({
        title: (updated.title ?? "").toString(),
        summary: (updated.summary ?? "").toString(),
        occurred_at: (updated.occurred_at ?? "").toString(),
        date_precision: (updated.date_precision ?? "day") as "day" | "month" | "year",
        category: (updated.category ?? "").toString(),
        event_type: (updated.event_type ?? "").toString(),
        tagsCsv: Array.isArray(updated.tags) ? updated.tags.join(", ") : "",
      });

      const t = (updated?.title ?? "Details").toString();
      navigation.setOptions({ title: t.length > 26 ? "Details" : t });

      setEditing(false);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to save changes.";
      setErr(msg);
      Alert.alert("Save failed", msg);
    } finally {
      setSaving(false);
    }
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
            <AppText variant="caption" style={{ color: colors.danger, fontWeight: "700" }}>
              {err}
            </AppText>
          </Card>
        ) : null}

        {!busy && item ? (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTopRow}>
                <View style={styles.iconChip}>
                  <AppText style={styles.iconChipText}>{iconForCategory(item.category)}</AppText>
                </View>

                <View style={styles.headerActions}>
                  {!editing ? (
                    <Pressable
                      onPress={() => setEditing(true)}
                      style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.75 }]}
                      disabled={saving}
                    >
                      <AppText variant="caption" style={styles.smallBtnText}>
                        Edit
                      </AppText>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable
                        onPress={cancelEdit}
                        style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.75 }]}
                        disabled={saving}
                      >
                        <AppText variant="caption" style={styles.smallBtnText}>
                          Cancel
                        </AppText>
                      </Pressable>

                      <Pressable
                        onPress={saveEdit}
                        style={({ pressed }) => [
                          styles.smallBtnPrimary,
                          pressed && { opacity: 0.85 },
                        ]}
                        disabled={saving}
                      >
                        <AppText variant="caption" style={styles.smallBtnPrimaryText}>
                          {saving ? "Saving..." : "Save"}
                        </AppText>
                      </Pressable>
                    </>
                  )}
                </View>
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

              {editing ? (
                <Card style={styles.editCard}>
                  <AppText variant="caption" style={styles.sectionLabel}>
                    Edit Fields
                  </AppText>

                  <Field label="Title">
                    <TextInput
                      value={draft?.title ?? ""}
                      onChangeText={(t) => setDraft((d) => (d ? { ...d, title: t } : d))}
                      placeholder="Title"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                      editable={!saving}
                    />
                  </Field>

                  <Field label="Summary">
                    <TextInput
                      value={draft?.summary ?? ""}
                      onChangeText={(t) => setDraft((d) => (d ? { ...d, summary: t } : d))}
                      placeholder="Write a short summary..."
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.inputMultiline]}
                      multiline
                      editable={!saving}
                    />
                  </Field>

                  <View style={styles.twoCol}>
                    <View style={{ flex: 1 }}>
                      <Field label="Date (YYYY-MM-DD)">
                        <TextInput
                          value={draft?.occurred_at ?? ""}
                          onChangeText={(t) => setDraft((d) => (d ? { ...d, occurred_at: t } : d))}
                          placeholder="2025-11-17"
                          placeholderTextColor={colors.muted}
                          style={styles.input}
                          editable={!saving}
                        />
                      </Field>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Field label="Precision">
                        <View style={styles.segmentRow}>
                          {(["day", "month", "year"] as const).map((p) => {
                            const active = (draft?.date_precision ?? "day") === p;
                            return (
                              <Pressable
                                key={p}
                                onPress={() => setDraft((d) => (d ? { ...d, date_precision: p } : d))}
                                style={({ pressed }) => [
                                  styles.segment,
                                  active && styles.segmentActive,
                                  pressed && { opacity: 0.85 },
                                ]}
                                disabled={saving}
                              >
                                <AppText
                                  variant="caption"
                                  style={[styles.segmentText, active && styles.segmentTextActive]}
                                >
                                  {p}
                                </AppText>
                              </Pressable>
                            );
                          })}
                        </View>
                      </Field>
                    </View>
                  </View>

                  <View style={styles.twoCol}>
                    <View style={{ flex: 1 }}>
                      <Field label="Category">
                        <TextInput
                          value={draft?.category ?? ""}
                          onChangeText={(t) => setDraft((d) => (d ? { ...d, category: t } : d))}
                          placeholder="Vitals, Lifestyle, Medications..."
                          placeholderTextColor={colors.muted}
                          style={styles.input}
                          editable={!saving}
                        />
                      </Field>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Field label="Event Type">
                        <TextInput
                          value={draft?.event_type ?? ""}
                          onChangeText={(t) => setDraft((d) => (d ? { ...d, event_type: t } : d))}
                          placeholder="lab_result, visit_note..."
                          placeholderTextColor={colors.muted}
                          style={styles.input}
                          editable={!saving}
                        />
                      </Field>
                    </View>
                  </View>

                  <Field label="Tags (comma separated)">
                    <TextInput
                      value={draft?.tagsCsv ?? ""}
                      onChangeText={(t) => setDraft((d) => (d ? { ...d, tagsCsv: t } : d))}
                      placeholder="blood pressure, follow up"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                      editable={!saving}
                    />
                  </Field>

                  <AppText variant="muted">
                    Tip: Save to push changes to Supabase. Timeline will refresh when you go back.
                  </AppText>
                </Card>
              ) : null}
            </View>

            {/* Summary (read view) */}
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
                  trackColor={{ false: colors.bgSecondary, true: colors.tealSoft }}
                  thumbColor={included ? colors.teal : colors.subtle}
                  ios_backgroundColor={colors.bgSecondary}
                />
              </View>

              {saving ? <AppText variant="caption" style={{ color: colors.muted }}>Saving...</AppText> : null}
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

              {item.data ? <JsonBlock value={item.data} /> : <AppText variant="muted">No structured data.</AppText>}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="caption" style={styles.fieldLabel}>{label}</AppText>
      {children}
    </View>
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
  container: { padding: spacing.md, gap: spacing.sm },
  center: { paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.sm },

  header: { gap: spacing.xs, paddingBottom: spacing.xs },

  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },

  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  smallBtnText: { fontWeight: typescale.weight.bold, color: colors.teal },

  smallBtnPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.teal,
  },
  smallBtnPrimaryText: { fontWeight: typescale.weight.bold, color: "#FFFFFF" },

  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconChipText: { fontWeight: typescale.weight.bold, color: colors.teal },

  title: { color: colors.text },
  meta: { textAlign: "left" },

  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },

  card: { gap: spacing.sm },
  editCard: { gap: spacing.sm, marginTop: spacing.sm },
  errorCard: { borderWidth: 1, borderColor: colors.danger },

  sectionLabel: { color: colors.muted },
  bodyText: {
    color: colors.textSub,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
  },

  fieldLabel: { color: colors.muted },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
  },
  inputMultiline: {
    minHeight: 92,
    textAlignVertical: "top",
  },

  twoCol: {
    flexDirection: "row",
    gap: spacing.sm,
  },

  segmentRow: {
    flexDirection: "row",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  segmentText: { fontWeight: typescale.weight.semibold, color: colors.muted },
  segmentTextActive: { color: colors.teal },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  infoLabel: { color: colors.muted, fontWeight: typescale.weight.semibold },
  infoValue: { color: colors.text, fontWeight: typescale.weight.medium, textAlign: "right", flex: 1 },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontWeight: typescale.weight.semibold, color: colors.teal },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontWeight: typescale.weight.bold },

  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { fontWeight: typescale.weight.semibold, color: colors.muted },

  dataHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  jsonWrap: { gap: spacing.xs },
  jsonToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  jsonToggleText: { fontWeight: typescale.weight.semibold, color: colors.teal },
  jsonText: {
    fontFamily: "Menlo",
    fontSize: typescale.size.xs,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    color: colors.textSub,
  },
});
