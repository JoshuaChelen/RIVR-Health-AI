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
import { AppText } from "../../components/ui/Primitives/AppText";
import { categoryMeta } from "../../components/ui/Timeline/TimelineCard";
import { colors, radius, shadows, spacing, typescale } from "../../theme/tokens";

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

type Draft = {
  title: string;
  summary: string;
  occurred_at: string;
  date_precision: "day" | "month" | "year";
  category: string;
  event_type: string;
  tagsCsv: string;
};

export function TimelineEventDetailsScreen({ route, navigation }: Props) {
  const id = route.params?.id;

  const [item, setItem]     = useState<TimelineEventRow | null>(null);
  const [busy, setBusy]     = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]   = useState<Draft | null>(null);

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
        setDraft({
          title:          (row.title ?? "").toString(),
          summary:        (row.summary ?? "").toString(),
          occurred_at:    (row.occurred_at ?? "").toString(),
          date_precision: (row.date_precision ?? "day") as "day" | "month" | "year",
          category:       (row.category ?? "").toString(),
          event_type:     (row.event_type ?? "").toString(),
          tagsCsv:        Array.isArray(row.tags) ? row.tags.join(", ") : "",
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

  const onToggleIncluded = async (next: boolean) => {
    if (!item) return;
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
      title:          (item.title ?? "").toString(),
      summary:        (item.summary ?? "").toString(),
      occurred_at:    (item.occurred_at ?? "").toString(),
      date_precision: (item.date_precision ?? "day") as "day" | "month" | "year",
      category:       (item.category ?? "").toString(),
      event_type:     (item.event_type ?? "").toString(),
      tagsCsv:        Array.isArray(item.tags) ? item.tags.join(", ") : "",
    });
    setEditing(false);
    setErr(null);
  };

  const saveEdit = async () => {
    if (!item || !draft) return;
    setErr(null);

    if (draft.occurred_at.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(draft.occurred_at.trim())) {
      setErr("Date must be in YYYY-MM-DD format.");
      return;
    }

    const tags = draft.tagsCsv.split(",").map((t) => t.trim()).filter(Boolean);
    const payload: Partial<TimelineEventRow> = {
      title:          draft.title.trim() || null,
      summary:        draft.summary.trim() || null,
      occurred_at:    draft.occurred_at.trim() || null,
      date_precision: draft.date_precision,
      category:       draft.category.trim() || null,
      event_type:     draft.event_type.trim() || null,
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
      setDraft({
        title:          (updated.title ?? "").toString(),
        summary:        (updated.summary ?? "").toString(),
        occurred_at:    (updated.occurred_at ?? "").toString(),
        date_precision: (updated.date_precision ?? "day") as "day" | "month" | "year",
        category:       (updated.category ?? "").toString(),
        event_type:     (updated.event_type ?? "").toString(),
        tagsCsv:        Array.isArray(updated.tags) ? updated.tags.join(", ") : "",
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const meta = categoryMeta(item?.category ?? "");

  const clinicalRows = useMemo(() => {
    return item?.data ? flattenData(item.data) : [];
  }, [item?.data]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Loading ──────────────────────────────────────────── */}
        {busy ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
            <AppText style={styles.loadingText}>Loading…</AppText>
          </View>
        ) : null}

        {/* ── Error ────────────────────────────────────────────── */}
        {err ? (
          <View style={styles.errorBanner}>
            <AppText style={styles.errorText}>{err}</AppText>
          </View>
        ) : null}

        {!busy && item ? (
          <>
            {/* ── Header card ──────────────────────────────────── */}
            <View style={styles.headerCard}>
              {/* Icon + edit button row */}
              <View style={styles.headerTopRow}>
                <View style={[styles.categoryIcon, { backgroundColor: meta.iconBg }]}>
                  <AppText style={[styles.categoryIconText, { color: meta.iconColor }]}>
                    {meta.iconSymbol}
                  </AppText>
                </View>

                <View style={styles.headerActions}>
                  {!editing ? (
                    <Pressable
                      onPress={() => setEditing(true)}
                      disabled={saving}
                      style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
                    >
                      <AppText style={styles.editBtnText}>Edit</AppText>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable
                        onPress={cancelEdit}
                        disabled={saving}
                        style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
                      >
                        <AppText style={styles.editBtnText}>Cancel</AppText>
                      </Pressable>
                      <Pressable
                        onPress={saveEdit}
                        disabled={saving}
                        style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
                      >
                        <AppText style={styles.saveBtnText}>
                          {saving ? "Saving…" : "Save"}
                        </AppText>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>

              {/* Title */}
              <AppText style={styles.title}>{item.title ?? "Untitled"}</AppText>

              {/* Date + source meta */}
              <AppText style={styles.dateMeta}>
                {formatDate(item.occurred_at, item.date_precision ?? undefined)}
                {item.source ? `  ·  ${prettySource(item.source)}` : ""}
              </AppText>

              {/* Category + event type pills */}
              <View style={styles.pillsRow}>
                <CategoryPill meta={meta} label={pretty(item.category)} />
                {item.event_type ? (
                  <View style={styles.typePill}>
                    <AppText style={styles.typePillText}>{item.event_type}</AppText>
                  </View>
                ) : null}
              </View>
            </View>

            {/* ── Edit form ────────────────────────────────────── */}
            {editing ? (
              <View style={styles.card}>
                <AppText style={styles.sectionLabel}>EDIT FIELDS</AppText>

                <FormField label="Title">
                  <TextInput
                    value={draft?.title ?? ""}
                    onChangeText={(t) => setDraft((d) => (d ? { ...d, title: t } : d))}
                    placeholder="Title"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    editable={!saving}
                  />
                </FormField>

                <FormField label="Summary">
                  <TextInput
                    value={draft?.summary ?? ""}
                    onChangeText={(t) => setDraft((d) => (d ? { ...d, summary: t } : d))}
                    placeholder="Write a short summary…"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.inputMultiline]}
                    multiline
                    editable={!saving}
                  />
                </FormField>

                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <FormField label="Date (YYYY-MM-DD)">
                      <TextInput
                        value={draft?.occurred_at ?? ""}
                        onChangeText={(t) => setDraft((d) => (d ? { ...d, occurred_at: t } : d))}
                        placeholder="2025-11-17"
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                        editable={!saving}
                      />
                    </FormField>
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormField label="Precision">
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
                              <AppText style={[styles.segmentText, active && styles.segmentTextActive]}>
                                {p}
                              </AppText>
                            </Pressable>
                          );
                        })}
                      </View>
                    </FormField>
                  </View>
                </View>

                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <FormField label="Category">
                      <TextInput
                        value={draft?.category ?? ""}
                        onChangeText={(t) => setDraft((d) => (d ? { ...d, category: t } : d))}
                        placeholder="Vitals, Medications…"
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                        editable={!saving}
                      />
                    </FormField>
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormField label="Event Type">
                      <TextInput
                        value={draft?.event_type ?? ""}
                        onChangeText={(t) => setDraft((d) => (d ? { ...d, event_type: t } : d))}
                        placeholder="lab_result, visit…"
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                        editable={!saving}
                      />
                    </FormField>
                  </View>
                </View>

                <FormField label="Tags (comma separated)">
                  <TextInput
                    value={draft?.tagsCsv ?? ""}
                    onChangeText={(t) => setDraft((d) => (d ? { ...d, tagsCsv: t } : d))}
                    placeholder="blood pressure, follow up"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    editable={!saving}
                  />
                </FormField>

                <AppText style={styles.editHint}>
                  Changes are saved to your timeline immediately.
                </AppText>
              </View>
            ) : null}

            {/* ── Summary ──────────────────────────────────────── */}
            <View style={styles.card}>
              <AppText style={styles.sectionLabel}>SUMMARY</AppText>
              <AppText style={styles.summaryText}>
                {item.summary?.trim() || "No summary provided yet."}
              </AppText>
            </View>

            {/* ── Details ──────────────────────────────────────── */}
            <View style={styles.card}>
              <AppText style={styles.sectionLabel}>DETAILS</AppText>
              <InfoRow label="Date"       value={formatDate(item.occurred_at, item.date_precision ?? undefined)} isLast={false} />
              <InfoRow label="Category"   value={pretty(item.category)}  isLast={false} />
              <InfoRow label="Source"     value={prettySource(item.source)} isLast={false} />
              <InfoRow label="Event type" value={pretty(item.event_type)} isLast={true} />
            </View>

            {/* ── Clinical Data ────────────────────────────────── */}
            {clinicalRows.length > 0 ? (
              <View style={styles.card}>
                <AppText style={styles.sectionLabel}>CLINICAL DATA</AppText>
                {clinicalRows.map((row, i) => (
                  <InfoRow
                    key={row.label + i}
                    label={row.label}
                    value={row.value}
                    isLast={i === clinicalRows.length - 1}
                  />
                ))}
              </View>
            ) : null}

            {/* ── Tags ─────────────────────────────────────────── */}
            {(item.tags ?? []).length > 0 ? (
              <View style={styles.card}>
                <AppText style={styles.sectionLabel}>TAGS</AppText>
                <View style={styles.tagsWrap}>
                  {(item.tags ?? []).map((t) => (
                    <View key={t} style={styles.tagChip}>
                      <AppText style={styles.tagText}>{t}</AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* ── Pre-Visit Note toggle ─────────────────────────── */}
            <View style={styles.preVisitCard}>
              <View style={styles.preVisitIconWrap}>
                <AppText style={styles.preVisitIcon}>🩺</AppText>
              </View>
              <View style={styles.preVisitText}>
                <AppText style={styles.preVisitTitle}>Pre-Visit Note</AppText>
                <AppText style={styles.preVisitSub}>
                  {included
                    ? "Included in your next doctor visit"
                    : "Add this event to your pre-visit note"}
                </AppText>
              </View>
              <Switch
                value={included}
                onValueChange={onToggleIncluded}
                disabled={saving}
                trackColor={{ false: colors.bgSecondary, true: colors.tealSoft }}
                thumbColor={included ? colors.teal : colors.subtle}
                ios_backgroundColor={colors.bgSecondary}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <AppText style={styles.fieldLabel}>{label}</AppText>
      {children}
    </View>
  );
}

function InfoRow({ label, value, isLast }: { label: string; value: string; isLast: boolean }) {
  return (
    <View style={[styles.infoRow, isLast && styles.infoRowLast]}>
      <AppText style={styles.infoLabel}>{label}</AppText>
      <AppText style={styles.infoValue} numberOfLines={3}>{value}</AppText>
    </View>
  );
}

function CategoryPill({ meta, label }: { meta: ReturnType<typeof categoryMeta>; label: string }) {
  return (
    <View style={[styles.catPill, { backgroundColor: meta.pillBg }]}>
      <AppText style={[styles.catPillText, { color: meta.pillText }]}>{label}</AppText>
    </View>
  );
}

// ─── Data flattening ─────────────────────────────────────────────────────────

type DataRow = { label: string; value: string };

function flattenData(obj: any, prefix = ""): DataRow[] {
  if (!obj || typeof obj !== "object") return [];
  const rows: DataRow[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value == null || value === "") continue;

    const label = prefix
      ? `${prefix} › ${formatKey(key)}`
      : formatKey(key);

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const formatted = value
        .map((item) => {
          if (item == null) return null;
          if (typeof item === "string") return item.trim();
          if (typeof item === "object") {
            return Object.values(item)
              .filter((v) => v != null && v !== "")
              .join(" ");
          }
          return String(item);
        })
        .filter(Boolean)
        .join(", ");
      if (formatted) rows.push({ label, value: formatted });
    } else if (typeof value === "object") {
      // One level of nesting — expand inline
      rows.push(...flattenData(value, formatKey(key)));
    } else {
      const formatted =
        typeof value === "boolean"
          ? value ? "Yes" : "No"
          : String(value).trim();
      if (formatted) rows.push({ label, value: formatted });
    }
  }

  return rows;
}

function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pretty(x?: string | null) {
  return (x ?? "").trim() || "Unknown";
}

function prettySource(x?: string | null) {
  const s = (x ?? "").toLowerCase();
  if (s === "document_upload") return "Document Upload";
  if (s === "manual_entry")    return "Manual Entry";
  if (s === "wearable")        return "Wearable";
  if (s === "ai_guided")       return "AI Guided";
  return (x ?? "").trim() || "Unknown";
}

function formatDate(ymd?: string | null, precision?: "day" | "month" | "year") {
  if (!ymd) return "No date";
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (precision === "year")  return `${dt.getFullYear()}`;
  if (precision === "month") return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return dt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Loading
  center: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typescale.size.sm,
    color: colors.muted,
  },

  // Error
  errorBanner: {
    backgroundColor: colors.dangerSoft,
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

  // Header card
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryIconText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.black,
    lineHeight: typescale.size.base * 1.4,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  editBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  editBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
  },
  saveBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.teal,
  },
  saveBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  title: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    lineHeight: typescale.size.xl * typescale.lineHeight.tight,
  },
  dateMeta: {
    fontSize: typescale.size.sm,
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  catPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  catPillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typePillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
  },

  // Content cards (Summary, Details, Clinical Data, Tags)
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  sectionLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    letterSpacing: 1.1,
    marginBottom: spacing.xxs,
  },
  summaryText: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Info rows
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  infoRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  infoLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flex: 1,
    paddingTop: 2,
  },
  infoValue: {
    fontSize: typescale.size.sm,
    color: colors.text,
    fontWeight: typescale.weight.medium,
    flex: 2,
    textAlign: "right",
  },

  // Tags
  tagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tagChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  tagText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },

  // Pre-Visit toggle card
  preVisitCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.card,
  },
  preVisitIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  preVisitIcon: {
    fontSize: 18,
    lineHeight: 24,
  },
  preVisitText: {
    flex: 1,
    gap: 3,
  },
  preVisitTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  preVisitSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Edit form
  fieldLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    color: colors.text,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
  },
  inputMultiline: {
    minHeight: 88,
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
    backgroundColor: colors.bg,
  },
  segmentActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  segmentText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.teal,
  },
  editHint: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    fontStyle: "italic",
  },
});
