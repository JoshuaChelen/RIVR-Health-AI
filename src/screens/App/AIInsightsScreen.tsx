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
import { captureException } from "../../lib/sentry";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { radius, shadows, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
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

  const styles = useStyles();
  const { colors } = useTheme();

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
      captureException(e);
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
          <ErrorBanner message="Couldn't load recommendations" onRetry={load} />
        ) : null}

        {/* ── Loading ───────────────────────────────────────── */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.teal} size="small" accessibilityLabel="Loading recommendations" />
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
        {!loading && !error && hasRecommendations ? (
          <View style={styles.disclaimerRow}>
            <Ionicons name="information-circle-outline" size={12} color={colors.subtle} />
            <AppText style={styles.disclaimerText}>
              {disclaimer
                ? String(disclaimer)
                : "These recommendations are AI-generated from the health data you provided and are for informational purposes only. They do not constitute medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider."}
            </AppText>
          </View>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

function PageHeader({ count }: { count: number | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.ph_wrap}>
      <View style={styles.ph_eyebrowRow}>
        <Ionicons name="sparkles-outline" size={11} color={colors.teal} />
        <AppText style={styles.ph_eyebrow}>AI · PERSONALISED</AppText>
      </View>

      <View style={styles.ph_titleRow}>
        <AppText style={styles.ph_title}>Recommendations</AppText>
        {count != null ? (
          <View style={styles.ph_countBadge}>
            <AppText style={styles.ph_countText}>{count}</AppText>
          </View>
        ) : null}
      </View>

      <AppText style={styles.ph_subtitle}>
        {count != null
          ? `${count} action${count === 1 ? "" : "s"} personalised to your health data`
          : "Add health data to generate personalised guidance"}
      </AppText>
    </View>
  );
}

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

  const styles = useStyles();
  const { colors } = useTheme();

  const canExpand   = titleTruncated || bodyTruncated;
  const catStyle    = CATEGORY_STYLE[item.category];
  const accentColor = PRIORITY_ACCENT[item.priority];

  return (
    <View style={[styles.rc_card, { borderLeftColor: accentColor }]}>

      {/* ── Meta: badge + priority tag ───────────────────── */}
      <View style={styles.rc_metaRow}>
        <View style={[styles.rc_categoryBadge, { backgroundColor: catStyle.bg }]}>
          <AppText style={[styles.rc_categoryText, { color: catStyle.text }]}>
            {item.category}
          </AppText>
        </View>

        <View style={styles.rc_metaSpacer} />

        {item.priority === "high" ? (
          <View style={styles.rc_priorityTag}>
            <View style={[styles.rc_priorityDot, { backgroundColor: accentColor }]} />
            <AppText style={[styles.rc_priorityLabel, { color: accentColor }]}>
              High priority
            </AppText>
          </View>
        ) : null}
      </View>

      {/* ── Text content wrapper ─────────────────────────────
            onLayout captures the real available width so hidden
            measurers use the same constraint as the visible text. */}
      <View
        style={styles.rc_textContent}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && w !== textWidth) setTextWidth(w);
        }}
      >
        {/* Visible title — clamped when collapsed, free when expanded.
            Separate JSX branches force React to unmount/remount the
            native Text node so no stale numberOfLines value persists. */}
        {!isExpanded ? (
          <AppText style={styles.rc_title} numberOfLines={TITLE_CLAMP}>
            {item.title}
          </AppText>
        ) : (
          <AppText style={styles.rc_title}>{item.title}</AppText>
        )}

        {/* Visible body */}
        {!isExpanded ? (
          item.body ? (
            <AppText style={styles.rc_body} numberOfLines={BODY_CLAMP}>
              {item.body}
            </AppText>
          ) : null
        ) : (
          item.body ? (
            <AppText style={styles.rc_body}>{item.body}</AppText>
          ) : null
        )}

        {/* Hidden measurers — rendered once width is known.
            position: absolute so they don't push the card height.
            width: textWidth ensures the same line-wrapping as the visible text.
            onTextLayout reports the real (unclamped) line count. */}
        {textWidth != null ? (
          <>
            <AppText
              style={[styles.rc_title, styles.rc_measurer, { width: textWidth }]}
              onTextLayout={(e) =>
                setTitleTruncated(e.nativeEvent.lines.length > TITLE_CLAMP)
              }
              importantForAccessibility="no"
            >
              {item.title}
            </AppText>

            {item.body ? (
              <AppText
                style={[styles.rc_body, styles.rc_measurer, { width: textWidth }]}
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
          style={({ pressed }) => [styles.rc_expandBtn, pressed && { opacity: 0.7 }]}
          onPress={() => setIsExpanded((v) => !v)}
          hitSlop={8}
        >
          <AppText style={styles.rc_expandBtnText}>
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
          style={({ pressed }) => [styles.rc_actionPill, pressed && { opacity: 0.72 }]}
          onPress={() => onAction(item.actionType)}
        >
          <AppText style={styles.rc_actionText}>{item.actionLabel}</AppText>
          <Ionicons name="arrow-forward" size={11} color={colors.teal} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ navigation }: { navigation: Props["navigation"] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.es_wrap}>
      <View style={styles.es_iconCircle}>
        <Ionicons name="bulb-outline" size={28} color={colors.teal} />
      </View>

      <AppText style={styles.es_title}>No recommendations yet</AppText>
      <AppText style={styles.es_body}>
        Upload medical records, complete your health profile, or connect Apple
        Health — then generate AI insights to see personalised guidance here.
      </AppText>

      <View style={styles.es_actions}>
        <Pressable
          style={({ pressed }) => [styles.es_btn, pressed && { opacity: 0.78 }]}
          onPress={() => navigation.navigate("ManageDocuments")}
        >
          <Ionicons name="document-text-outline" size={13} color={colors.teal} />
          <AppText style={styles.es_btnText}>Add Records</AppText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.es_btn, pressed && { opacity: 0.78 }]}
          onPress={() => navigation.navigate("MedicalProfile")}
        >
          <Ionicons name="person-outline" size={13} color={colors.teal} />
          <AppText style={styles.es_btnText}>Edit Profile</AppText>
        </Pressable>
      </View>

      <AppText style={styles.es_hint}>
        AI insights are generated when you process your health data.
      </AppText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
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
    backgroundColor: c.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: c.dangerBorder,
  },
  errorText: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: c.danger,
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
    color: c.muted,
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
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // ── PageHeader ──────────────────────────────────────────
  ph_wrap: {
    paddingBottom: spacing.xs,
    gap: spacing.xxs,
  },
  ph_eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    marginBottom: 2,
  },
  ph_eyebrow: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.teal,
    letterSpacing: 1.1,
  },
  ph_titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  ph_title: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.extrabold,
    color: c.text,
    letterSpacing: -0.3,
  },
  ph_countBadge: {
    backgroundColor: c.teal,
    borderRadius: radius.pill,
    minWidth: 26,
    height: 26,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  ph_countText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  ph_subtitle: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    marginTop: 2,
  },

  // ── RecommendationCard ──────────────────────────────────
  rc_card: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    borderLeftWidth: 4,
    // borderLeftColor set inline from PRIORITY_ACCENT
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  rc_metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  rc_categoryBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rc_categoryText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    letterSpacing: 0.1,
  },
  rc_metaSpacer: {
    flex: 1,
  },
  rc_priorityTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  rc_priorityDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  rc_priorityLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },
  rc_textContent: {
    gap: spacing.xs,
  },
  rc_measurer: {
    position: "absolute",
    opacity: 0,
  },
  rc_title: {
    fontSize: typescale.size.md,
    fontWeight: typescale.weight.semibold,
    color: c.text,
    lineHeight: typescale.size.md * typescale.lineHeight.normal,
    marginTop: spacing.xxs,
  },
  rc_body: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  rc_expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
  },
  rc_expandBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },
  rc_actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.tealBorder,
  },
  rc_actionText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },

  // ── EmptyState ──────────────────────────────────────────
  es_wrap: {
    marginTop: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  es_iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: c.tealBorder,
  },
  es_title: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold,
    color: c.text,
    textAlign: "center",
  },
  es_body: {
    fontSize: typescale.size.sm,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.sm,
    maxWidth: 280,
  },
  es_actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  es_btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.tealBorder,
  },
  es_btnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },
  es_hint: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    textAlign: "center",
    marginTop: spacing.xxs,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
}));
