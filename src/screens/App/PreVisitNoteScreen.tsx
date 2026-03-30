import React, { useCallback, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Animated,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { spacing, radius, typescale, shadows } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import { captureException } from "../../lib/sentry";
import Ionicons from "@expo/vector-icons/Ionicons";

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

function buildCategoryConfig(c: { blue: string; blueSoft: string; green: string; greenSoft: string; orange: string; orangeSoft: string }) {
  const map: Record<string, { dot: string; label: string; bg: string; text: string }> = {
    medications: { dot: c.blue,    label: "Medications", bg: c.blueSoft,    text: "#1D4ED8" },
    vitals:      { dot: c.green,   label: "Vitals",      bg: c.greenSoft,   text: c.green  },
    labs:        { dot: c.green,   label: "Labs",        bg: c.greenSoft,   text: c.green  },
    lifestyle:   { dot: "#BE185D", label: "Lifestyle",   bg: "#FCE7F3",     text: "#9D174D" },
  };
  return map;
}

function categoryConfig(category: string, c: { blue: string; blueSoft: string; green: string; greenSoft: string; orange: string; orangeSoft: string }) {
  const map = buildCategoryConfig(c);
  const key = Object.keys(map).find((k) => category.toLowerCase().includes(k));
  return key
    ? map[key]
    : { dot: c.orange, label: category, bg: c.orangeSoft, text: c.orange };
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, index }: { event: TimelineEventRow; index: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(1)).current;
  const cfg  = categoryConfig(event.category, colors);

  const onPressIn  = () => Animated.spring(anim, { toValue: 0.985, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () => Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 25 }).start();

  return (
    <Animated.View style={[styles.ec_wrapper, { transform: [{ scale: anim }] }]}>
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.ec_card}
      >
        {/* Index + category dot row */}
        <View style={styles.ec_topRow}>
          <View style={styles.ec_indexBadge}>
            <AppText style={styles.ec_indexText}>{index + 1}</AppText>
          </View>

          <View style={[styles.ec_categoryDot, { backgroundColor: cfg.dot }]} />

          <View style={styles.ec_titleBlock}>
            <AppText style={styles.ec_title} numberOfLines={2}>{event.title}</AppText>
          </View>

          <AppText style={styles.ec_date}>{formatEventDate(event.occurred_at, event.date_precision)}</AppText>
        </View>

        {/* Summary */}
        {event.summary?.trim() ? (
          <AppText style={styles.ec_summary} numberOfLines={3}>
            {event.summary.trim()}
          </AppText>
        ) : null}

        {/* Category pill */}
        <View style={[styles.ec_catPill, { backgroundColor: cfg.bg }]}>
          <AppText style={[styles.ec_catLabel, { color: cfg.text }]}>{cfg.label}</AppText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.sh_row}>
      <View style={styles.sh_accent} />
      <AppText style={styles.sh_title}>{title}</AppText>
      {count != null ? (
        <View style={styles.sh_countPill}>
          <AppText style={styles.sh_countText}>{count}</AppText>
        </View>
      ) : null}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function PreVisitNoteScreen({ navigation }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

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
      captureException(e);
      setErr(e?.message ?? "Failed to load pre-visit note.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hasEvents = rows.length > 0;

  return (
    <Screen edges={["left", "right", "bottom"]}>
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
            <ActivityIndicator color={colors.teal} accessibilityLabel="Loading pre-visit note" />
          </View>
        ) : null}

        {/* ── Document header card ────────────────────────────── */}
        <View style={styles.docCard}>
          {/* Left teal accent bar */}
          <View style={styles.docAccent} />

          <View style={styles.docBody}>
            <View style={styles.docTopRow}>
              <View style={styles.docIconWrap}>
                <Ionicons name="medkit-outline" size={18} color={colors.teal} />
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
              <Ionicons name="document-text-outline" size={40} color={colors.muted} />
              <AppText style={styles.emptyTitle}>No events selected</AppText>
              <AppText style={styles.emptyBody}>
                Go to the Timeline and toggle{"\n"}
                "Include in Pre-Visit Note" on events{"\n"}
                you want to share with your doctor.
              </AppText>
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Open Timeline"
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
                accessible
                accessibilityRole="button"
                accessibilityLabel="Share pre-visit note"
                style={({ pressed }) => [styles.shareBtn, pressed && styles.btnPressed]}
                onPress={() => navigation.navigate("Share")}
              >
                <AppText style={styles.shareBtnText}>Share</AppText>
              </Pressable>

              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Edit selection"
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

const useStyles = createStyles((c) => StyleSheet.create({
  // ── EventCard (ec) ─────────────────────────────────────────────────────
  ec_wrapper: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  ec_card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.xs,
  },
  ec_topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  ec_indexBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.tealSoft,
    borderWidth: 1,
    borderColor: c.tealBorder,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ec_indexText: {
    fontSize: 10,
    fontWeight: typescale.weight.bold,
    color: c.teal,
    lineHeight: 13,
  },
  ec_categoryDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  ec_titleBlock: {
    flex: 1,
  },
  ec_title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: c.text,
    lineHeight: typescale.size.base * typescale.lineHeight.normal,
  },
  ec_date: {
    fontSize: typescale.size.xs,
    color: c.muted,
    flexShrink: 0,
  },
  ec_summary: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingLeft: 28, // align with title (badge + dot width)
  },
  ec_catPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginLeft: 28,
    marginTop: spacing.xxs,
  },
  ec_catLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },

  // ── SectionHeader (sh) ────────────────────────────────────────────────
  sh_row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  sh_accent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: c.teal,
  },
  sh_title: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sh_countPill: {
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sh_countText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.teal,
  },

  // ── Main styles ────────────────────────────────────────────────────────
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.lg,
    gap: spacing.sm,
  },

  // Error
  errorBanner: {
    backgroundColor: c.dangerSoft,
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
    paddingVertical: spacing.xl,
    alignItems: "center",
  },

  // Document header card
  docCard: {
    flexDirection: "row",
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
    ...shadows.card,
  },
  docAccent: {
    width: 4,
    backgroundColor: c.teal,
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
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  docTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  docMeta: {
    fontSize: typescale.size.xs,
    color: c.muted,
    marginTop: 2,
  },
  readyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: c.successSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.success,
  },
  readyText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.success,
  },
  docDivider: {
    height: 1,
    backgroundColor: c.borderLight,
  },
  docDisclaimer: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Empty state
  emptyWrap: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
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

  // Actions
  actionsDivider: {
    height: 1,
    backgroundColor: c.border,
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
    backgroundColor: c.teal,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.teal,
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
    backgroundColor: c.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
  },
}));
