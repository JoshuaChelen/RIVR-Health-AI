import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useSession } from "../../context/SessionContext";
import { listTimeline, updateTimelineEvent, getProfile } from "../../lib/api/data";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  TextInput,
} from "react-native";
import { SetVisitDateModal } from "../../components/ui/Timeline/SetVisitDateModal";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";


import { captureException } from "../../lib/sentry";
import {
  askHealthQuestion,
  type AiQuestionResult,
} from "../../lib/aiQuestionSearch";
import {
  clinicalTagsForEvent,
  formatTimelineDateMain,
  normalizeTimelineEvent,
  parseYMD,
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

export function TimelineScreen({ navigation }: Props) {
  const [events, setEvents]         = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);
  const [patientDob, setPatientDob] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [aiResult, setAiResult] = useState<AiQuestionResult>({ status: "idle" });
  const [aiSearching, setAiSearching] = useState(false);

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

  const { user } = useSession();

  const load = useCallback(async (offset = 0, append = false) => {
    if (!append) setErr(null);
    try {
      const result = await listTimeline(
        `?limit=${PAGE_SIZE}&offset=${offset}&exclude_source=apple_health&ordering=-occurred_at`,
      );

      type RawRow = Omit<TimelineEventRow, "documentTitle"> & {
        documents: { title: string | null } | { title: string | null }[] | null;
      };

      if (!append && patientDob == null) {
        const profile = await getProfile();
        const dob = (profile as { date_of_birth?: string | null } | null)?.date_of_birth ?? null;
        setPatientDob(dob);
      }

      const rows = ((result.results ?? []) as unknown as RawRow[])
        .filter((e) => e.source !== "apple_health")
        .map<TimelineEventRow>((e) => {
          // Postgrest may return the join as a single object or as a 1-element
          // array depending on the relationship metadata. Handle both shapes.
          const doc = Array.isArray(e.documents) ? e.documents[0] : e.documents;
          const documentTitle = doc?.title ?? null;
          return normalizeTimelineEvent({ ...e, documentTitle });
        });

      setHasMore(result.count > offset + PAGE_SIZE);

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
  }, [patientDob, user]);

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

  useEffect(() => {
    const question = searchQuery.trim();
    if (!question) {
      setAiSearching(false);
      setAiResult({ status: "idle" });
      return;
    }

    let cancelled = false;
    setAiSearching(true);

    const timer = setTimeout(async () => {
      try {
        const result = await askHealthQuestion(question);

        if (!cancelled) {
          setAiResult(result);
        }
      } catch {
        if (!cancelled) {
          setAiResult({
            status: "unavailable",
            message: "AI search is unavailable right now. Try again after the AI worker is connected.",
          });
        }
      } finally {
        if (!cancelled) {
          setAiSearching(false);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    const dated   = events.filter((e) => !!e.occurred_at && !!e.date_precision);
    const undated = events.filter((e) =>  !e.occurred_at ||  !e.date_precision);

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
  }, [events]);

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
    try {
      await updateTimelineEvent(eventId, { included_in_previsit: next });
    } catch {
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
            placeholder="Ask AI about your records..."
            placeholderTextColor={colors.subtle}
            showSoftInputOnFocus
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Ask AI about your health records"
          />
          {searchQuery ? (
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Clear AI search"
              onPress={() => setSearchQuery("")}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={16} color={colors.subtle} />
            </Pressable>
          ) : null}
        </View>
        {searchQuery ? (
          <AppText style={styles.searchResultText}>AI searches your uploaded records and timeline.</AppText>
        ) : (
          <AppText style={styles.searchHint}>
            Ask what medications you were taking after surgery, or what records mention shoulder pain.
          </AppText>
        )}
      </View>
      {searchQuery.trim() ? (
        <View style={styles.aiAnswerCard}>
          <View style={styles.aiAnswerIcon}>
            <Ionicons name="sparkles-outline" size={15} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={styles.aiAnswerTitle}>AI answer from your records</AppText>
            <AppText style={styles.aiAnswerBody}>
              {aiSearching
                ? "Reviewing your uploaded documents, health summary, and timeline..."
                : aiResult.status === "answered"
                  ? aiResult.answer
                  : aiResult.status === "unavailable"
                    ? aiResult.message
                    : "Type a question to ask about your health records."}
            </AppText>
            {aiResult.status === "answered" && aiResult.sources.length > 0 ? (
              <View style={styles.aiSources}>
                {aiResult.sources.map((source, index) => (
                  <View key={`${source.title}-${index}`} style={styles.aiSourcePill}>
                    <AppText style={styles.aiSourceText} numberOfLines={1}>
                      {source.type ? `${source.type}: ` : ""}{source.title}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  ), [err, load, undatedCount, scrollToUnknown, styles, colors, searchQuery, aiSearching, aiResult]);

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
  aiAnswerCard: {
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
  aiAnswerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  aiAnswerTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  aiAnswerBody: {
    marginTop: 2,
    fontSize: typescale.size.xs,
    color: c.textSub,
    lineHeight: typescale.size.xs * typescale.lineHeight.normal,
  },
  aiSources: {
    marginTop: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  aiSourcePill: {
    maxWidth: "100%",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bgSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  aiSourceText: {
    fontSize: typescale.size.xs,
    color: c.textSub,
    fontWeight: typescale.weight.medium,
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
