import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Share,
  Animated,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "PreVisitNote">;

type DatePrecision = "day" | "month" | "year";

type TimelineEventRow = {
  id: string;
  occurred_at: string;
  date_precision: DatePrecision;
  title: string;
  category: string;
  source: string;
  summary: string;
  included_in_previsit: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatEventDate(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);
  if (precision === "year")  return `${dt.getFullYear()}`;
  if (precision === "month") return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const CATEGORY_CONFIG: Record<string, { dot: string; label: string; bg: string; text: string }> = {
  medications: { dot: colors.blue,    label: "Medications", bg: colors.blueSoft,    text: "#1D4ED8" },
  vitals:      { dot: colors.green,   label: "Vitals",      bg: colors.greenSoft,   text: colors.green  },
  labs:        { dot: colors.green,   label: "Labs",        bg: colors.greenSoft,   text: colors.green  },
  lifestyle:   { dot: "#BE185D",      label: "Lifestyle",   bg: "#FCE7F3",          text: "#9D174D"     },
};

function categoryConfig(category: string) {
  const key = Object.keys(CATEGORY_CONFIG).find((k) => category.toLowerCase().includes(k));
  return key
    ? CATEGORY_CONFIG[key]
    : { dot: colors.orange, label: category, bg: colors.orangeSoft, text: colors.orange };
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, index }: { event: TimelineEventRow; index: number }) {
  const anim = useRef(new Animated.Value(1)).current;
  const cfg  = categoryConfig(event.category);

  const onPressIn  = () => Animated.spring(anim, { toValue: 0.985, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () => Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 25 }).start();

  return (
    <Animated.View style={[eStyles.wrapper, { transform: [{ scale: anim }] }]}>
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={eStyles.card}
      >
        {/* Index + category dot row */}
        <View style={eStyles.topRow}>
          <View style={eStyles.indexBadge}>
            <AppText style={eStyles.indexText}>{index + 1}</AppText>
          </View>

          <View style={[eStyles.categoryDot, { backgroundColor: cfg.dot }]} />

          <View style={eStyles.titleBlock}>
            <AppText style={eStyles.title} numberOfLines={2}>{event.title}</AppText>
          </View>

          <AppText style={eStyles.date}>{formatEventDate(event.occurred_at, event.date_precision)}</AppText>
        </View>

        {/* Summary */}
        {event.summary?.trim() ? (
          <AppText style={eStyles.summary} numberOfLines={3}>
            {event.summary.trim()}
          </AppText>
        ) : null}

        {/* Category pill */}
        <View style={[eStyles.catPill, { backgroundColor: cfg.bg }]}>
          <AppText style={[eStyles.catLabel, { color: cfg.text }]}>{cfg.label}</AppText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const eStyles = StyleSheet.create({
  wrapper: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.xs,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  indexBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  indexText: {
    fontSize: 10,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    lineHeight: 13,
  },
  categoryDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
    lineHeight: typescale.size.base * typescale.lineHeight.normal,
  },
  date: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    flexShrink: 0,
  },
  summary: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingLeft: 28, // align with title (badge + dot width)
  },
  catPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginLeft: 28,
    marginTop: spacing.xxs,
  },
  catLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },
});

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={shStyles.row}>
      <View style={shStyles.accent} />
      <AppText style={shStyles.title}>{title}</AppText>
      {count != null ? (
        <View style={shStyles.countPill}>
          <AppText style={shStyles.countText}>{count}</AppText>
        </View>
      ) : null}
    </View>
  );
}

const shStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  accent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: colors.teal,
  },
  title: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  countPill: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export function PreVisitNoteScreen({ navigation }: Props) {
  const [rows, setRows]             = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setLoading(true);
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userData.user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("timeline_events")
        .select("id, occurred_at, date_precision, title, category, source, summary, included_in_previsit")
        .eq("user_id", userData.user.id)
        .eq("included_in_previsit", true)
        .order("occurred_at", { ascending: false });

      if (error) throw error;
      setRows((data ?? []) as TimelineEventRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load pre-visit note.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Build the plain-text version for sharing
  const noteText = useMemo(() => {
    if (rows.length === 0) return "";

    const lines: string[] = [];
    lines.push("Pre-Visit Note");
    lines.push(`Generated: ${new Date().toLocaleDateString()}`);
    lines.push("");

    for (const ev of rows) {
      lines.push(`• ${formatEventDate(ev.occurred_at, ev.date_precision)} — ${ev.title} (${ev.category})`);
      if (ev.summary?.trim()) lines.push(`  ${ev.summary.trim()}`);
      lines.push("");
    }

    return lines.join("\n").trim();
  }, [rows]);

  const onShare = async () => {
    if (!noteText) return;
    try { await Share.share({ message: noteText }); }
    catch { /* ignore */ }
  };

  const hasEvents = rows.length > 0;

  return (
    <Screen>
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
        {/* ── Error banner ────────────────────────────────────── */}
        {err ? (
          <View style={styles.errorBanner}>
            <AppText style={styles.errorText}>{err}</AppText>
          </View>
        ) : null}

        {/* ── Loading ─────────────────────────────────────────── */}
        {loading && !refreshing ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : null}

        {/* ── Document header card ────────────────────────────── */}
        <View style={styles.docCard}>
          {/* Left teal accent bar */}
          <View style={styles.docAccent} />

          <View style={styles.docBody}>
            <View style={styles.docTopRow}>
              <View style={styles.docIconWrap}>
                <AppText style={styles.docIcon}>🩺</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={styles.docTitle}>Pre-Visit Note</AppText>
                <AppText style={styles.docMeta}>
                  {loading
                    ? "Loading…"
                    : hasEvents
                    ? `${rows.length} event${rows.length === 1 ? "" : "s"} selected · ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
                    : "No events selected yet"}
                </AppText>
              </View>
              {hasEvents ? (
                <View style={styles.readyBadge}>
                  <View style={styles.readyDot} />
                  <AppText style={styles.readyText}>Ready</AppText>
                </View>
              ) : null}
            </View>

            <View style={styles.docDivider} />

            <AppText style={styles.docDisclaimer}>
              This note summarises your selected health timeline events for your upcoming appointment.
              Review with your care provider.
            </AppText>
          </View>
        </View>

        {/* ── Event list ──────────────────────────────────────── */}
        {!loading ? (
          hasEvents ? (
            <>
              <SectionHeader title="Included events" count={rows.length} />
              {rows.map((ev, i) => (
                <EventCard key={ev.id} event={ev} index={i} />
              ))}
            </>
          ) : (
            <View style={styles.emptyWrap}>
              <AppText style={styles.emptySymbol}>📋</AppText>
              <AppText style={styles.emptyTitle}>No events selected</AppText>
              <AppText style={styles.emptyBody}>
                Go to the Timeline and toggle{"\n"}
                "Include in Pre-Visit Note" on events{"\n"}
                you want to share with your doctor.
              </AppText>
              <Pressable
                style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
                onPress={() => navigation.navigate("Timeline")}
              >
                <AppText style={styles.emptyBtnText}>Open Timeline</AppText>
              </Pressable>
            </View>
          )
        ) : null}

        {/* ── Actions ─────────────────────────────────────────── */}
        {hasEvents && !loading ? (
          <>
            <View style={styles.actionsDivider} />
            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.shareBtn, pressed && styles.btnPressed]}
                onPress={onShare}
              >
                <AppText style={styles.shareBtnText}>Share note</AppText>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.timelineBtn, pressed && { opacity: 0.7 }]}
                onPress={() => navigation.navigate("Timeline")}
              >
                <AppText style={styles.timelineBtnText}>Edit selection</AppText>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.lg,
    gap: spacing.sm,
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

  // Loading
  loadingWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },

  // Document header card
  docCard: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.card,
  },
  docAccent: {
    width: 4,
    backgroundColor: colors.teal,
  },
  docBody: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  docTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  docIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  docIcon: {
    fontSize: 18,
    lineHeight: 24,
  },
  docTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  docMeta: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    marginTop: 2,
  },
  readyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.successSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  readyText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.success,
  },
  docDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  docDisclaimer: {
    fontSize: typescale.size.xs,
    color: colors.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Empty state
  emptyWrap: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptySymbol: {
    fontSize: 40,
    lineHeight: 50,
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

  // Actions
  actionsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  shareBtn: {
    flex: 1.4,
    height: 48,
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  shareBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  timelineBtn: {
    flex: 1,
    height: 48,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
  },
});
