import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { SetVisitDateModal } from "../../components/ui/Timeline/SetVisitDateModal";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { supabase } from "../../lib/supabase";
import { captureException } from "../../lib/sentry";
import {
  clinicalTagsForEvent,
  formatTimelineDateMain,
  healthCardMatchesQuery,
  normalizeTimelineEvent,
  timelineMatchesQuery,
  type DatePrecision,
  type NormalizedTimelineEvent,
} from "../../lib/timeline";
import { TimelineCard, categoryMeta } from "../../components/ui/Timeline/TimelineCard";
import { MonthDivider } from "../../components/ui/Timeline/MonthDivider";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { spacing, radius, typescale, shadows } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

type Props = NativeStackScreenProps<AppStackParamList, "Timeline">;

type TimelineEventRow = NormalizedTimelineEvent;

type RenderRow =
  | { kind: "month"; key: string; label: string }
  | { kind: "unknownHeader"; key: string }
  | { kind: "event"; key: string; event: TimelineEventRow; isLastInGroup: boolean };

const PAGE_SIZE = 30;
const VOICE_SEARCH_ENABLED = process.env.EXPO_PUBLIC_ENABLE_VOICE_SEARCH === "true";

export function TimelineScreen({ navigation }: Props) {
  const [events, setEvents]         = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);
  const [patientDob, setPatientDob] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [healthCard, setHealthCard] = useState<any>(null);
  const [voiceListening, setVoiceListening] = useState(false);

  const flatListRef = useRef<FlatList<RenderRow>>(null);

  const [modalDoc, setModalDoc] = useState<{
    documentId: string;
    documentTitle: string;
    count: number;
  } | null>(null);

  // Live ref into the events array. Read from this inside identity-stable
  // callbacks so they don't force renderItem rebuild on every events change.
  const eventsRef = useRef<TimelineEventRow[]>([]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const styles = useStyles();
  const { colors } = useTheme();

  const load = useCallback(async (offset = 0, append = false) => {
    if (!append) setErr(null);
    try {
      const { data, error } = await supabase
        .from("timeline_events")
        .select(
          "id, occurred_at, date_precision, title, event_type, category, source, summary, included_in_previsit, document_id, created_at, tags, data, documents(title)"
        )
        .neq("source", "apple_health")
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;

      type RawRow = Omit<TimelineEventRow, "documentTitle"> & {
        documents: { title: string | null } | { title: string | null }[] | null;
      };

      if (!append && patientDob == null) {
        const { data: userRes } = await supabase.auth.getUser();
        const userId = userRes?.user?.id;
        if (userId) {
          const [profileResult, healthResult] = await Promise.all([
            supabase
              .from("user_profiles")
              .select("date_of_birth")
              .eq("user_id", userId)
              .maybeSingle(),
            supabase
              .from("health_profiles")
              .select("card_json, summary_json")
              .eq("user_id", userId)
              .maybeSingle(),
          ]);
          const profileRow = profileResult.data;
          setPatientDob((profileRow as { date_of_birth?: string | null } | null)?.date_of_birth ?? null);
          setHealthCard(healthResult.data ?? null);
        }
      }

      const rows = ((data ?? []) as unknown as RawRow[])
        .filter((e) => e.source !== "apple_health")
        .map<TimelineEventRow>((e) => {
          // Postgrest may return the join as a single object or as a 1-element
          // array depending on the relationship metadata. Handle both shapes.
          const doc = Array.isArray(e.documents) ? e.documents[0] : e.documents;
          const documentTitle = doc?.title ?? null;
          return normalizeTimelineEvent({ ...e, documentTitle });
        });

      setHasMore(rows.length === PAGE_SIZE);

      if (append) {
        setEvents((prev) => [...prev, ...rows]);
      } else {
        setEvents(rows);
      }
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Failed to load timeline.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [patientDob]);

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

  const visibleEvents = useMemo(
    () => events.filter((event) => timelineMatchesQuery(event, searchQuery)),
    [events, searchQuery],
  );
  const hasHealthCardSearchMatch = useMemo(
    () => healthCardMatchesQuery(healthCard, searchQuery),
    [healthCard, searchQuery],
  );

  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    const dated   = visibleEvents.filter((e) => !!e.occurred_at && !!e.date_precision);
    const undated = visibleEvents.filter((e) =>  !e.occurred_at ||  !e.date_precision);

    // Dated rows with month dividers.
    let lastMonthKey: string | null = null;
    for (let i = 0; i < dated.length; i++) {
      const ev = dated[i];
      const monthKey = monthBucketKey(ev.occurred_at!, ev.date_precision!);
      if (monthKey !== lastMonthKey) {
        out.push({
          kind: "month",
          key: `m-${monthKey}`,
          label: monthDividerLabel(ev.occurred_at!, ev.date_precision!),
        });
        lastMonthKey = monthKey;
      }

      const next = dated[i + 1];
      const isLastInGroup =
        !next ||
        monthBucketKey(next.occurred_at!, next.date_precision!) !== monthKey;

      out.push({ kind: "event", key: `e-${ev.id}`, event: ev, isLastInGroup });
    }

    // Unknown-date section pinned at the bottom.
    if (undated.length > 0) {
      out.push({ kind: "unknownHeader", key: "unknown-header" });
      for (let i = 0; i < undated.length; i++) {
        const ev = undated[i];
        out.push({
          kind: "event",
          key: `e-${ev.id}`,
          event: ev,
          isLastInGroup: i === undated.length - 1,
        });
      }
    }

    return out;
  }, [visibleEvents]);

  const undatedCount = useMemo(
    () => events.filter((e) => !e.occurred_at || !e.date_precision).length,
    [events],
  );

  const unknownHeaderIndex = useMemo(
    () => rows.findIndex((r) => r.kind === "unknownHeader"),
    [rows],
  );

  const openSetDate = useCallback(
    (event: TimelineEventRow) => {
      if (!event.document_id) return;
      // Read events via ref so this callback's identity stays stable across
      // events changes — avoids cascading renderItem rebuilds.
      const count = eventsRef.current.filter(
        (e) =>
          e.document_id === event.document_id &&
          (!e.occurred_at || !e.date_precision),
      ).length;
      setModalDoc({
        documentId:    event.document_id,
        documentTitle: event.documentTitle ?? "Document",
        count,
      });
    },
    [],
  );

  const onToggleIncluded = useCallback(async (eventId: string, next: boolean) => {
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
  }, []);

  const includedEvents = events.filter((e) => !!e.included_in_previsit);
  const previewItems   = includedEvents.slice(0, 3);

  const renderItem = useCallback(({ item: row }: { item: RenderRow }) => {
    if (row.kind === "month") {
      return <MonthDivider label={row.label} style={styles.monthDivider} />;
    }

    if (row.kind === "unknownHeader") {
      return (
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel="Unknown date section"
          style={styles.unknownHeaderWrap}
        >
          <View style={styles.unknownHeaderBadge}>
            <AppText style={styles.unknownHeaderBadgeText}>Unknown date</AppText>
          </View>
          <View style={styles.unknownHeaderLine} />
        </View>
      );
    }

    const ev      = row.event;
    const meta    = categoryMeta(ev.category, colors);
    const undated = !ev.occurred_at || !ev.date_precision;
    const dateDisplay = formatTimelineDateMain(ev, patientDob);

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
          dateLabel={undated ? "Date unknown" : dateDisplay.primary}
          dateSubLabel={undated ? dateDisplay.secondary : dateDisplay.secondary}
          category={ev.category}
          source={ev.source}
          summary={ev.summary}
          clinicalTags={clinicalTagsForEvent(ev)}
          included={ev.included_in_previsit}
          onToggleIncluded={(next) => onToggleIncluded(ev.id, next)}
          onPress={() => navigation.navigate("Details", { id: ev.id })}
          onSetDate={undated && ev.document_id ? () => openSetDate(ev) : undefined}
          style={styles.card}
        />
      </View>
    );
  }, [navigation, onToggleIncluded, openSetDate, styles, colors, patientDob]);

  const scrollToUnknown = useCallback(() => {
    if (unknownHeaderIndex < 0) return;
    flatListRef.current?.scrollToIndex({
      index:    unknownHeaderIndex,
      animated: true,
      viewPosition: 0,
    });
  }, [unknownHeaderIndex]);

  const startVoiceSearch = useCallback(() => {
    if (!VOICE_SEARCH_ENABLED) {
      Alert.alert("Voice search unavailable", "Typed search is available in this release.");
      return;
    }

    if (Platform.OS !== "web") {
      Alert.alert("Voice search unavailable", "Typed search is available on this device.");
      return;
    }

    const speechApi =
      (globalThis as any).SpeechRecognition ??
      (globalThis as any).webkitSpeechRecognition;
    if (!speechApi) {
      Alert.alert("Voice search unavailable", "Typed search is available in this browser.");
      return;
    }

    try {
      const recognition = new speechApi();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => setVoiceListening(true);
      recognition.onerror = () => setVoiceListening(false);
      recognition.onend = () => setVoiceListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript;
        if (typeof transcript === "string" && transcript.trim()) {
          setSearchQuery(transcript.trim());
        }
      };
      recognition.start();
    } catch (_e) {
      setVoiceListening(false);
      Alert.alert("Voice search unavailable", "Typed search is available in this browser.");
    }
  }, []);

  const listHeader = useMemo(() => (
    <>
      {err ? (
        <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
          <ErrorBanner message="Couldn't load your timeline" onRetry={() => load()} />
        </View>
      ) : null}

      {undatedCount > 0 ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${undatedCount} events need a date. Tap to scroll to them.`}
          onPress={scrollToUnknown}
          style={({ pressed }) => [styles.undatedBanner, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.undatedBannerIcon}>
            <Ionicons name="calendar-outline" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={styles.undatedBannerTitle}>
              {undatedCount} event{undatedCount === 1 ? "" : "s"} need a date
            </AppText>
            <AppText style={styles.undatedBannerSub}>
              Tap to set the visit date so they appear in order.
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.teal} />
        </Pressable>
      ) : null}

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={colors.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search injuries, dates, meds, body parts..."
            placeholderTextColor={colors.subtle}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search timeline"
          />
          {searchQuery ? (
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Clear timeline search"
              onPress={() => setSearchQuery("")}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={16} color={colors.subtle} />
            </Pressable>
          ) : null}
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={voiceListening ? "Listening for voice search" : "Start voice search"}
            accessibilityState={{ selected: voiceListening }}
            onPress={startVoiceSearch}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={voiceListening ? "mic" : "mic-outline"}
              size={17}
              color={voiceListening ? colors.teal : colors.subtle}
            />
          </Pressable>
        </View>
        {searchQuery ? (
          <AppText style={styles.searchResultText}>
            {visibleEvents.length} matching event{visibleEvents.length === 1 ? "" : "s"}
            {hasHealthCardSearchMatch ? " + health card match" : ""}
          </AppText>
        ) : (
          <AppText style={styles.searchHint}>
            Try left thumb injury, 2018, or medications after surgery.
          </AppText>
        )}
      </View>
      {searchQuery && hasHealthCardSearchMatch ? (
        <View style={styles.healthCardMatch}>
          <View style={styles.healthCardMatchIcon}>
            <Ionicons name="id-card-outline" size={15} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={styles.healthCardMatchTitle}>Health card match</AppText>
            <AppText style={styles.healthCardMatchBody} numberOfLines={2}>
              Your emergency card or AI summary contains matching medications, conditions, allergies, procedures, or notes.
            </AppText>
          </View>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Open health summary"
            onPress={() => navigation.navigate("HealthSummary")}
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={17} color={colors.teal} />
          </Pressable>
        </View>
      ) : null}
    </>
  ), [err, load, undatedCount, scrollToUnknown, styles, colors, searchQuery, visibleEvents.length, hasHealthCardSearchMatch, navigation, startVoiceSearch, voiceListening]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.teal} accessibilityLabel="Loading timeline" />
          <AppText style={styles.loadingText}>Loading your health timeline…</AppText>
        </View>
      );
    }
    if (!err && searchQuery.trim() && !hasHealthCardSearchMatch) {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="search-outline" size={24} color={colors.teal} />
          </View>
          <AppText style={styles.emptyTitle}>No matching timeline events</AppText>
          <AppText style={styles.emptyBody}>
            Try a year, body part, diagnosis, medication, surgery, or symptom.
          </AppText>
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
  }, [loading, err, navigation, styles, colors, searchQuery, hasHealthCardSearchMatch]);

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
            Toggle Pre-Visit on any timeline event above to add it to your doctor note.
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
    <>
      <FlatList
        ref={flatListRef}
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
        onScrollToIndexFailed={(info) => {
          // Fallback when the row hasn't been measured yet (e.g. unknown
          // section is below the viewport at first paint). Scroll to a
          // best-effort offset, then retry the precise scroll.
          flatListRef.current?.scrollToOffset({
            offset:   info.averageItemLength * info.index,
            animated: true,
          });
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index:    info.index,
              animated: true,
              viewPosition: 0,
            });
          }, 250);
        }}
      />

      {modalDoc ? (
        <SetVisitDateModal
          visible
          documentId={modalDoc.documentId}
          documentTitle={modalDoc.documentTitle}
          undatedEventCount={modalDoc.count}
          onSaved={() => {
            setHasMore(true);
            load(0, false);
          }}
          onClose={() => setModalDoc(null)}
        />
      ) : null}
    </>
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
    borderColor: c.dangerBorder,
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

  // Search
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  searchBox: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.xs,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: c.text,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
    paddingVertical: 0,
  },
  searchHint: {
    fontSize: typescale.size.xs,
    color: c.muted,
    paddingHorizontal: spacing.xs,
  },
  searchResultText: {
    fontSize: typescale.size.xs,
    color: c.teal,
    fontWeight: typescale.weight.semibold,
    paddingHorizontal: spacing.xs,
  },
  healthCardMatch: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.tealBorder,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadows.xs,
  },
  healthCardMatchIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  healthCardMatchTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  healthCardMatchBody: {
    marginTop: 2,
    fontSize: typescale.size.xs,
    color: c.textSub,
    lineHeight: typescale.size.xs * typescale.lineHeight.normal,
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

  // Undated banner
  undatedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: c.tealSoft,
    borderWidth: 1,
    borderColor: c.tealBorder,
    borderRadius: radius.md,
  },
  undatedBannerIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  undatedBannerTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: c.teal,
  },
  undatedBannerSub: {
    fontSize: typescale.size.xs,
    color: c.teal,
    opacity: 0.85,
    marginTop: 1,
  },

  // Unknown-date section header (appears once, between dated and undated rows)
  unknownHeaderWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  unknownHeaderBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.bgSecondary,
    borderWidth: 1,
    borderColor: c.border,
    flexShrink: 0,
  },
  unknownHeaderBadgeText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  unknownHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: c.borderLight,
  },
}));
