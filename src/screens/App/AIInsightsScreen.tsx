import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { getHealthProfile, getLatestEvaluation } from "../../lib/aiJobs";
import { getCurrentUserId } from "../../lib/auth";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, radius, shadows, spacing, typescale } from "../../theme/tokens";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  buildRecommendations,
  CATEGORY_STYLE,
  PRIORITY_ACCENT,
  type RecommendationItem,
} from "../../lib/recommendations";

type Props = NativeStackScreenProps<AppStackParamList, "AIInsights">;

// ─── Expand thresholds ────────────────────────────────────────────────────────

const TITLE_CLAMP = 2;
const BODY_CLAMP  = 3;

// ─── Screen ───────────────────────────────────────────────────────────────────

export function AIInsightsScreen({ navigation }: Props) {
  const [loading, setLoading]         = useState(true);
  const [summaryJson, setSummaryJson] = useState<any>(null);
  const [evaluation, setEval]         = useState<any>(null);
  const [error, setError]             = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const userId = await getCurrentUserId();
      const [profile, evalRow] = await Promise.all([
        getHealthProfile(userId),
        getLatestEvaluation(userId),
      ]);
      setSummaryJson(profile?.summary_json ?? null);
      setEval(evalRow?.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load recommendations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const recommendations    = buildRecommendations(loading ? null : summaryJson, loading ? null : evaluation);
  const hasRecommendations = recommendations.length > 0;
  const disclaimer         = summaryJson?.disclaimer ?? evaluation?.disclaimer ?? null;

  function handleAction(actionType?: string) {
    if (actionType === "navigate_documents")         navigation.navigate("ManageDocuments");
    else if (actionType === "navigate_profile")      navigation.navigate("MedicalProfile");
    else if (actionType === "navigate_apple_health") navigation.navigate("AppleHealth");
  }

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Error ─────────────────────────────────────────── */}
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
            <AppText style={styles.errorText}>{error}</AppText>
          </View>
        ) : null}

        {/* ── Loading ───────────────────────────────────────── */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.teal} size="small" />
            <AppText style={styles.loadingText}>Loading recommendations…</AppText>
          </View>
        ) : null}

        {/* ── Page header ───────────────────────────────────── */}
        {!loading && !error ? (
          <PageHeader count={hasRecommendations ? recommendations.length : null} />
        ) : null}

        {/* ── Recommendation cards ──────────────────────────── */}
        {!loading && !error && hasRecommendations ? (
          <View style={styles.cardList}>
            {recommendations.map((item) => (
              <RecommendationCard
                key={item.id}
                item={item}
                onAction={handleAction}
              />
            ))}
          </View>
        ) : null}

        {/* ── Empty state ───────────────────────────────────── */}
        {!loading && !error && !hasRecommendations ? (
          <EmptyState navigation={navigation} />
        ) : null}

        {/* ── Disclaimer footer ─────────────────────────────── */}
        {!loading && !error && hasRecommendations && disclaimer ? (
          <View style={styles.disclaimerRow}>
            <Ionicons name="information-circle-outline" size={12} color={colors.subtle} />
            <AppText style={styles.disclaimerText}>{String(disclaimer)}</AppText>
          </View>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

function PageHeader({ count }: { count: number | null }) {
  return (
    <View style={ph.wrap}>
      <View style={ph.eyebrowRow}>
        <Ionicons name="sparkles-outline" size={11} color={colors.teal} />
        <AppText style={ph.eyebrow}>AI · PERSONALISED</AppText>
      </View>

      <View style={ph.titleRow}>
        <AppText style={ph.title}>Recommendations</AppText>
        {count != null ? (
          <View style={ph.countBadge}>
            <AppText style={ph.countText}>{count}</AppText>
          </View>
        ) : null}
      </View>

      <AppText style={ph.subtitle}>
        {count != null
          ? `${count} action${count === 1 ? "" : "s"} personalised to your health data`
          : "Add health data to generate personalised guidance"}
      </AppText>
    </View>
  );
}

const ph = StyleSheet.create({
  wrap: {
    paddingBottom: spacing.xs,
    gap: spacing.xxs,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    marginBottom: 2,
  },
  eyebrow: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    letterSpacing: 1.1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.extrabold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  countBadge: {
    backgroundColor: colors.teal,
    borderRadius: radius.pill,
    minWidth: 26,
    height: 26,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  subtitle: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    marginTop: 2,
  },
});

// ─── RecommendationCard ───────────────────────────────────────────────────────
//
// One source of truth: item.title and item.body.
// Collapsed = clamped. Expanded = unclamped. Same text both ways.
//
// Truncation detection uses onTextLayout on hidden, absolutelypositioned Text
// nodes that render without numberOfLines. Their reported line count is compared
// to TITLE_CLAMP / BODY_CLAMP to decide whether "See more" should appear.
// This avoids char-count guessing — it's the actual rendered line count.

function RecommendationCard({
  item,
  onAction,
}: {
  item: RecommendationItem;
  onAction?: (type?: string) => void;
}) {
  const [isExpanded,     setIsExpanded]     = useState(false);
  const [titleTruncated, setTitleTruncated] = useState(false);
  const [bodyTruncated,  setBodyTruncated]  = useState(false);
  const [textWidth,      setTextWidth]      = useState<number | undefined>(undefined);

  const canExpand   = titleTruncated || bodyTruncated;
  const catStyle    = CATEGORY_STYLE[item.category];
  const accentColor = PRIORITY_ACCENT[item.priority];

  return (
    <View style={[rc.card, { borderLeftColor: accentColor }]}>

      {/* ── Meta: badge + priority tag ───────────────────── */}
      <View style={rc.metaRow}>
        <View style={[rc.categoryBadge, { backgroundColor: catStyle.bg }]}>
          <AppText style={[rc.categoryText, { color: catStyle.text }]}>
            {item.category}
          </AppText>
        </View>

        <View style={rc.metaSpacer} />

        {item.priority === "high" ? (
          <View style={rc.priorityTag}>
            <View style={[rc.priorityDot, { backgroundColor: accentColor }]} />
            <AppText style={[rc.priorityLabel, { color: accentColor }]}>
              High priority
            </AppText>
          </View>
        ) : null}
      </View>

      {/* ── Text content wrapper ─────────────────────────────
            onLayout captures the real available width so hidden
            measurers use the same constraint as the visible text. */}
      <View
        style={rc.textContent}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && w !== textWidth) setTextWidth(w);
        }}
      >
        {/* Visible title — clamped when collapsed, free when expanded.
            Separate JSX branches force React to unmount/remount the
            native Text node so no stale numberOfLines value persists. */}
        {!isExpanded ? (
          <AppText style={rc.title} numberOfLines={TITLE_CLAMP}>
            {item.title}
          </AppText>
        ) : (
          <AppText style={rc.title}>{item.title}</AppText>
        )}

        {/* Visible body */}
        {!isExpanded ? (
          item.body ? (
            <AppText style={rc.body} numberOfLines={BODY_CLAMP}>
              {item.body}
            </AppText>
          ) : null
        ) : (
          item.body ? (
            <AppText style={rc.body}>{item.body}</AppText>
          ) : null
        )}

        {/* Hidden measurers — rendered once width is known.
            position: absolute so they don't push the card height.
            width: textWidth ensures the same line-wrapping as the visible text.
            onTextLayout reports the real (unclamped) line count. */}
        {textWidth != null ? (
          <>
            <AppText
              style={[rc.title, rc.measurer, { width: textWidth }]}
              onTextLayout={(e) =>
                setTitleTruncated(e.nativeEvent.lines.length > TITLE_CLAMP)
              }
              importantForAccessibility="no"
            >
              {item.title}
            </AppText>

            {item.body ? (
              <AppText
                style={[rc.body, rc.measurer, { width: textWidth }]}
                onTextLayout={(e) =>
                  setBodyTruncated(e.nativeEvent.lines.length > BODY_CLAMP)
                }
                importantForAccessibility="no"
              >
                {item.body}
              </AppText>
            ) : null}
          </>
        ) : null}
      </View>

      {/* ── See more / Show less toggle ───────────────────── */}
      {canExpand ? (
        <Pressable
          style={({ pressed }) => [rc.expandBtn, pressed && { opacity: 0.7 }]}
          onPress={() => setIsExpanded((v) => !v)}
          hitSlop={8}
        >
          <AppText style={rc.expandBtnText}>
            {isExpanded ? "Show less" : "See more"}
          </AppText>
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.teal}
          />
        </Pressable>
      ) : null}

      {/* ── Action pill ──────────────────────────────────── */}
      {item.actionLabel && onAction ? (
        <Pressable
          style={({ pressed }) => [rc.actionPill, pressed && { opacity: 0.72 }]}
          onPress={() => onAction(item.actionType)}
        >
          <AppText style={rc.actionText}>{item.actionLabel}</AppText>
          <Ionicons name="arrow-forward" size={11} color={colors.teal} />
        </Pressable>
      ) : null}
    </View>
  );
}

const rc = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    // borderLeftColor set inline from PRIORITY_ACCENT
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },

  // ── Meta row ──────────────────────────────────────────
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  categoryBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  categoryText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    letterSpacing: 0.1,
  },
  metaSpacer: {
    flex: 1,
  },
  priorityTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  priorityDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  priorityLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },

  // ── Text content wrapper ──────────────────────────────
  // Groups title + body so onLayout captures the exact text width.
  // gap mirrors the card's gap so spacing is unchanged.
  textContent: {
    gap: spacing.xs,
  },

  // ── Hidden measurer ───────────────────────────────────
  // Invisible, position: absolute so it does not affect card height.
  // Used only to count unclamped lines via onTextLayout.
  measurer: {
    position: "absolute",
    opacity: 0,
  },

  // ── Content ───────────────────────────────────────────
  title: {
    fontSize: typescale.size.md,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
    lineHeight: typescale.size.md * typescale.lineHeight.normal,
    marginTop: spacing.xxs,
  },
  body: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // ── Expand toggle ─────────────────────────────────────
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
  },
  expandBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },

  // ── Action pill ───────────────────────────────────────
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  actionText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
});

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ navigation }: { navigation: Props["navigation"] }) {
  return (
    <View style={es.wrap}>
      <View style={es.iconCircle}>
        <Ionicons name="bulb-outline" size={28} color={colors.teal} />
      </View>

      <AppText style={es.title}>No recommendations yet</AppText>
      <AppText style={es.body}>
        Upload medical records, complete your health profile, or connect Apple
        Health — then generate AI insights to see personalised guidance here.
      </AppText>

      <View style={es.actions}>
        <Pressable
          style={({ pressed }) => [es.btn, pressed && { opacity: 0.78 }]}
          onPress={() => navigation.navigate("ManageDocuments")}
        >
          <Ionicons name="document-text-outline" size={13} color={colors.teal} />
          <AppText style={es.btnText}>Add Records</AppText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [es.btn, pressed && { opacity: 0.78 }]}
          onPress={() => navigation.navigate("MedicalProfile")}
        >
          <Ionicons name="person-outline" size={13} color={colors.teal} />
          <AppText style={es.btnText}>Edit Profile</AppText>
        </Pressable>
      </View>

      <AppText style={es.hint}>
        AI insights are generated when you process your health data.
      </AppText>
    </View>
  );
}

const es = StyleSheet.create({
  wrap: {
    marginTop: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  title: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    textAlign: "center",
  },
  body: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.sm,
    maxWidth: 280,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  btnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  hint: {
    fontSize: typescale.size.xs,
    color: colors.subtle,
    textAlign: "center",
    marginTop: spacing.xxs,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + spacing.lg,
    gap: spacing.md,
  },

  cardList: {
    gap: spacing.sm,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  loadingWrap: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typescale.size.sm,
    color: colors.muted,
  },

  disclaimerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
  disclaimerText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: colors.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
});
