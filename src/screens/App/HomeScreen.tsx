import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { getProfile } from "../../lib/profile";
import { useAvatarUrl } from "../../lib/avatar";
import { captureException } from "../../lib/sentry";
import { syncEmergencyCardToWidget } from "../../lib/emergencyCardWidget";
import { useSession } from "../../context/SessionContext";
import { listDocuments, getHealthProfile, getLatestEvaluation } from "../../lib/api/data";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { ScoreRing } from "../../components/ui/Home/ScoreRing";
import { spacing, radius, typescale, shadows } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAppleHealth } from "../../context/AppleHealthContext";
import type { AppleHealthContextValue } from "../../context/AppleHealthContext";
import {
  buildRecommendations,
  PRIORITY_ACCENT,
  type RecommendationItem,
} from "../../lib/recommendations";

type Props = NativeStackScreenProps<AppStackParamList, "Home">;
type MetricKey = "sleep" | "steps" | "heartRate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function HomeScreen({ navigation }: Props) {
  const { user } = useSession();
  const [scoreLoading, setScoreLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [profileInitials, setProfileInitials] = useState<string | null>(null);
  const [avatarPath, setAvatarPath]           = useState<string | null>(null);
  const avatarUrl                             = useAvatarUrl(avatarPath);
  const [aiRecommendations, setAiRecommendations] = useState<RecommendationItem[]>([]);
  const [error, setError] = useState(false);
  const [isScoreStale, setIsScoreStale] = useState(false);
  const [unreviewedCount, setUnreviewedCount] = useState(0);

  const styles = useStyles();
  const { colors } = useTheme();

  const load = useCallback(async () => {
    setScoreLoading(true);
    setError(false);
    try {
      if (!user) return;

      const userId = user.id;
      const [healthProfile, evalRow, userProfile, latestDocRes] = await Promise.all([
        getHealthProfile(),
        getLatestEvaluation(),
        getProfile(userId),
        listDocuments("?status=processed").then(res => ({
          data: res.results[0] ?? null
        })),
      ]);

      const evalResult = evalRow?.result ?? null;
      const resolvedScore =
        healthProfile?.score ?? evalResult?.score_0_to_100 ?? null;
      const resolvedLabel =
        healthProfile?.score_label ?? evalResult?.score_label ?? null;

      setScore(typeof resolvedScore === "number" ? resolvedScore : null);
      setLabel(typeof resolvedLabel === "string" ? resolvedLabel : null);
      syncEmergencyCardToWidget(
        healthProfile?.card_json ?? evalResult?.three_by_five_card ?? null,
        healthProfile?.updated_at ?? null,
      );

      const recs = buildRecommendations(
        healthProfile?.summary_json ?? null,
        evalResult,
      );
      setAiRecommendations(recs.slice(0, 3));

      if (userProfile?.first_name) {
        const first = userProfile.first_name[0]?.toUpperCase() ?? "";
        const last = userProfile.last_name?.[0]?.toUpperCase() ?? "";
        setProfileInitials(first + last);
      }

      setAvatarPath(userProfile?.avatar_path ?? null);
      setUnreviewedCount(Number(userProfile?.ai_review?.unreviewed) || 0);

      // Staleness: check if docs were processed after the last evaluation
      const latestDocAt = latestDocRes.data?.processed_at ?? null;
      const evalAt = evalRow?.created_at ?? null;
      setIsScoreStale(!!(
        typeof resolvedScore === "number" &&
        latestDocAt && evalAt &&
        new Date(latestDocAt).getTime() > new Date(evalAt).getTime()
      ));
    } catch (e) {
      captureException(e);
      setError(true);
    } finally {
      setScoreLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const health = useAppleHealth();

  const navigateToAppleHealth = useCallback(
    (metric?: MetricKey) => {
      navigation.navigate("AppleHealth", { initialMetric: metric });
    },
    [navigation]
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ──────────────────────────────────────── */}
        <View style={styles.greeting}>
          <View style={styles.greetLeft}>
            <AppText style={styles.greetDate}>{todayLabel()}</AppText>
            <AppText variant="h1" style={styles.greetTitle}>
              {timeGreeting()}
            </AppText>
          </View>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            style={({ pressed }) => [
              styles.profileAvatar,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => navigation.navigate("Profile")}
          >
            <AppText style={styles.profileAvatarText}>
              {profileInitials ?? "·"}
            </AppText>
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.profileAvatarImage}
                accessibilityLabel="Profile photo"
              />
            ) : null}
          </Pressable>
        </View>

        {/* ── AI findings to review nudge ────────────────────── */}
        {unreviewedCount > 0 ? (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Review ${unreviewedCount} AI findings`}
            onPress={() => navigation.navigate("ManageDocuments")}
            style={({ pressed }) => [
              {
                flexDirection: "row", alignItems: "center", gap: spacing.sm,
                marginHorizontal: spacing.xl, marginBottom: spacing.md,
                paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
                borderRadius: radius.md, backgroundColor: colors.tealSoft,
                borderWidth: 1, borderColor: colors.tealBorder,
              },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="sparkles-outline" size={18} color={colors.teal} />
            <AppText style={{ flex: 1, color: colors.teal, fontWeight: typescale.weight.semibold }}>
              {unreviewedCount} AI {unreviewedCount === 1 ? "finding" : "findings"} to review
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.teal} />
          </Pressable>
        ) : null}

        {/* ── Error ────────────────────────────────────────── */}
        {error && !scoreLoading ? (
          <View style={{ marginHorizontal: spacing.xl }}>
            <ErrorBanner message="Couldn't load your dashboard" onRetry={load} />
          </View>
        ) : null}

        {/* ── SHIN Score ring card ───────────────────────────── */}
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="SHIN Score card"
          accessibilityHint="View your SHIN Score details"
          style={({ pressed }) => [
            styles.heroCard,
            pressed && styles.heroPressed,
          ]}
          onPress={() => navigation.navigate("ShinScore")}
        >
          <View style={styles.heroHeader}>
            <View style={styles.heroLabelBlock}>
              <View style={styles.heroLabelRow}>
                <AppText style={styles.heroLabel}>SHIN SCORE</AppText>
                {isScoreStale ? (
                  <Pressable
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="Score may be outdated, tap to view details"
                    onPress={() => navigation.navigate("HealthSummary")}
                    hitSlop={8}
                    style={styles.staleBadge}
                  >
                    <View style={styles.staleDot} />
                    <AppText style={styles.staleLabel}>Summary outdated</AppText>
                  </Pressable>
                ) : null}
              </View>
              <AppText style={styles.heroSub}>AI wellness indicator</AppText>
            </View>
            {scoreLoading ? null : score != null ? (
              <View style={styles.labelPill}>
                <AppText
                  style={styles.labelPillText}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {label ?? "View details"}
                </AppText>
              </View>
            ) : (
              <View style={[styles.labelPill, styles.labelPillMuted]}>
                <AppText
                  style={styles.labelPillTextMuted}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  Not generated
                </AppText>
              </View>
            )}
          </View>

          <View style={styles.ringWrap}>
            {scoreLoading ? (
              <View style={styles.ringPlaceholder}>
                <ActivityIndicator color={colors.teal} size="large" accessibilityLabel="Loading score" />
                <AppText style={styles.ringPlaceholderText}>
                  Loading score…
                </AppText>
              </View>
            ) : score != null ? (
              <ScoreRing value={score} />
            ) : (
              <View style={styles.emptyScore}>
                <View style={styles.emptyScoreRing}>
                  <Ionicons
                    name="sparkles-outline"
                    size={22}
                    color={colors.teal}
                  />
                </View>
                <AppText style={styles.emptyScoreTitle}>No score yet</AppText>
                <AppText style={styles.emptyScoreBody}>
                  Fill in your profile or upload records,{"\n"}then generate
                  your SHIN Score.
                </AppText>
              </View>
            )}
          </View>
        </Pressable>

        {/* ── AI Health Summary card ─────────────────────────── */}
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="AI Health Summary"
          accessibilityHint="View your full health summary"
          style={({ pressed }) => [
            styles.summaryCard,
            pressed && styles.summaryPressed,
          ]}
          onPress={() => navigation.navigate("HealthSummary")}
        >
          <View style={styles.summaryAccent} />
          <View style={styles.summaryIconWrap}>
            <Ionicons name="sparkles-outline" size={18} color={colors.teal} />
          </View>
          <View style={styles.summaryTextBlock}>
            <AppText style={styles.summaryTitle}>AI Health Summary</AppText>
            <AppText style={styles.summarySub}>
              Full summary, essentials &amp; health story
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.teal} />
        </Pressable>

        {/* ── Ask AI card ───────────────────────────────────── */}
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Ask AI"
          accessibilityHint="Chat with AI about your health records"
          style={({ pressed }) => [
            styles.summaryCard,
            pressed && styles.summaryPressed,
          ]}
          onPress={() => navigation.navigate("AskAI")}
        >
          <View style={styles.summaryAccent} />
          <View style={styles.summaryIconWrap}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.teal} />
          </View>
          <View style={styles.summaryTextBlock}>
            <AppText style={styles.summaryTitle}>Ask AI</AppText>
            <AppText style={styles.summarySub}>
              Chat about your records, labs &amp; history
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.teal} />
        </Pressable>

        {/* ── Actions + metrics grid ─────────────────────────── */}
          <View style={styles.actionsRow}>
            <QuickAction
              label="Documents"
              icon={<Ionicons name="document-text-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate("ManageDocuments")}
            />
            <QuickAction
              label="Timeline"
              icon={<Ionicons name="calendar-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate("Timeline")}
            />
            <QuickAction
              label="Pre-Visit"
              icon={<Ionicons name="medkit-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate("PreVisitNote")}
            />
            <QuickAction
              label="Share"
              icon={<Ionicons name="share-social-outline" size={20} color={colors.text} />}
              onPress={() => navigation.navigate("Share")}
            />
          </View>

        {/* ── Dual card row: AI Suggestions + Apple Health ──── */}
        <View style={styles.dualCardRow}>
          <AiSuggestionsCard
            onPress={() => navigation.navigate("AIInsights")}
            recommendations={aiRecommendations}
            loading={scoreLoading}
          />
          <AppleHealthMiniCard
            health={health}
            onPress={navigateToAppleHealth}
          />
        </View>

        
      </ScrollView>
    </Screen>
  );
}

// ─── HomeFeatureCard — shared shell for the dual card row ────────────────────
//
// Enforces a consistent card structure across all sibling cards:
//   top accent border → header row → body (flex:1) → footer CTA
//
// accentColor drives the top border; iconBg drives the icon circle background.
// headerAccessory is an optional element inserted between the title and chevron
// (e.g. the live-data green dot on the Apple Health connected card).
// body fills remaining space so the footer always aligns with its sibling.

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quickBtn, pressed && styles.quickPressed]}
      onPress={onPress}
    >
      <View style={styles.quickIconWrap}>{icon}</View>
      <AppText style={styles.quickLabel}>{label}</AppText>
    </Pressable>
  );
}


function HomeFeatureCard({
  accentColor,
  iconBg,
  icon,
  title,
  titleColor,
  headerAccessory,
  footerLabel,
  footerColor,
  onPress,
  children,
}: {
  accentColor: string;
  iconBg: string;
  icon: React.ReactNode;
  title: string;
  titleColor?: string;
  headerAccessory?: React.ReactNode;
  footerLabel: string;
  footerColor?: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const resolvedFooterColor = footerColor ?? colors.teal;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.fcard_card,
        { borderTopColor: accentColor },
        pressed && styles.fcard_pressed,
      ]}
      onPress={onPress}
    >
      {/* ── Header ─────────────────────────────────── */}
      <View style={styles.fcard_header}>
        <View style={[styles.fcard_iconWrap, { backgroundColor: iconBg }]}>
          {icon}
        </View>
        <AppText
          style={[styles.fcard_title, titleColor ? { color: titleColor } : undefined]}
        >
          {title}
        </AppText>
        {headerAccessory}
        <Ionicons name="chevron-forward" size={13} color={colors.subtle} />
      </View>

      {/* ── Body — flex:1 keeps footer pinned to bottom ── */}
      <View style={styles.fcard_body}>{children}</View>

      {/* ── Footer CTA ─────────────────────────────── */}
      <View style={styles.fcard_footer}>
        <AppText style={[styles.fcard_footerText, { color: resolvedFooterColor }]}>
          {footerLabel}
        </AppText>
        <Ionicons name="arrow-forward" size={11} color={resolvedFooterColor} />
      </View>
    </Pressable>
  );
}

// ─── AI Suggestions card ──────────────────────────────────────────────────────

function AiSuggestionsCard({
  onPress,
  recommendations,
  loading,
}: {
  onPress: () => void;
  recommendations: RecommendationItem[];
  loading: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  let body: React.ReactNode;

  if (loading) {
    body = (
      <View style={styles.aiLoading}>
        <ActivityIndicator size="small" color={colors.teal} />
      </View>
    );
  } else if (recommendations.length > 0) {
    body = (
      <View style={styles.suggestionList}>
        {recommendations.map((item, i) => (
          <View
            key={item.id}
            style={[
              styles.suggestionRow,
              i < recommendations.length - 1 && styles.suggestionBorder,
            ]}
          >
            <View
              style={[
                styles.suggestionDot,
                { backgroundColor: PRIORITY_ACCENT[item.priority] },
              ]}
            />
            <AppText style={styles.suggestionText} numberOfLines={2}>
              {item.title}
            </AppText>
          </View>
        ))}
      </View>
    );
  } else {
    body = (
      <View style={styles.aiEmpty}>
        <Ionicons name="sparkles-outline" size={16} color={colors.subtle} />
        <AppText style={styles.aiEmptyText}>
          Generate AI insights to see personalised recommendations
        </AppText>
      </View>
    );
  }

  return (
    <HomeFeatureCard
      accentColor={colors.teal}
      iconBg={colors.tealSoft}
      icon={<Ionicons name="sparkles-outline" size={13} color={colors.teal} />}
      title="AI Suggestions"
      footerLabel="View all suggestions"
      onPress={onPress}
    >
      {body}
    </HomeFeatureCard>
  );
}

// ─── Apple Health mini card ───────────────────────────────────────────────────

// On Android the provider is Health Connect (Samsung Health syncs into it).
const HEALTH_LABEL = Platform.OS === "android" ? "Health Connect" : "Apple Health";

function AppleHealthMiniCard({
  health,
  onPress,
}: {
  health: AppleHealthContextValue;
  onPress: (metric?: MetricKey) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { status, heartRate, sleepAvgText, stepsAvg7d, sleepAvgMin } = health;
  const isConnected = status === "linked";

  // ── Unsupported ────────────────────────────────────────────────────────────
  if (status === "unsupported") {
    return (
      <HomeFeatureCard
        accentColor={colors.border}
        iconBg={colors.bgSecondary}
        icon={<Ionicons name="phone-portrait-outline" size={13} color={colors.subtle} />}
        title={HEALTH_LABEL}
        titleColor={colors.muted}
        footerLabel="Not available"
        footerColor={colors.subtle}
        onPress={() => onPress()}
      >
        <View style={styles.ahMiniEmpty}>
          <AppText style={styles.ahMiniEmptyLabel}>
            {Platform.OS === "android" ? "Unavailable" : "iPhone only"}
          </AppText>
          <AppText style={styles.ahMiniEmptySub}>
            Not available on this device
          </AppText>
        </View>
      </HomeFeatureCard>
    );
  }

  // ── Disconnected ───────────────────────────────────────────────────────────
  if (status === "disconnected") {
    return (
      <HomeFeatureCard
        accentColor={colors.warning}
        iconBg={colors.warnSoft}
        icon={<Ionicons name="heart-outline" size={13} color={colors.warning} />}
        title={HEALTH_LABEL}
        titleColor={colors.muted}
        footerLabel="Reconnect"
        footerColor={colors.teal}
        onPress={() => onPress()}
      >
        <View style={styles.ahMiniEmpty}>
          <AppText style={styles.ahMiniEmptyLabel}>Disconnected</AppText>
          <AppText style={styles.ahMiniEmptySub}>
            Tap to reconnect
          </AppText>
        </View>
      </HomeFeatureCard>
    );
  }

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <HomeFeatureCard
        accentColor={colors.border}
        iconBg={colors.bgSecondary}
        icon={<Ionicons name="heart-outline" size={13} color={colors.subtle} />}
        title={HEALTH_LABEL}
        titleColor={colors.muted}
        footerLabel="Connect"
        footerColor={colors.teal}
        onPress={() => onPress()}
      >
        <View style={styles.ahMiniEmpty}>
          <View style={styles.ahMiniEmptyIcon}>
            <Ionicons name="link-outline" size={20} color={colors.subtle} />
          </View>
          <AppText style={styles.ahMiniEmptyLabel}>Not connected</AppText>
          <AppText style={styles.ahMiniEmptySub}>
            Connect to view live vitals
          </AppText>
        </View>
      </HomeFeatureCard>
    );
  }

  // ── Connected ──────────────────────────────────────────────────────────────
  const hrVal = heartRate != null ? `${heartRate}` : "—";
  const sleepVal = sleepAvgMin != null ? sleepAvgText : "—";
  const stepsVal = stepsAvg7d != null ? stepsAvg7d.toLocaleString() : "—";

  return (
    <HomeFeatureCard
      accentColor={colors.teal}
      iconBg={colors.tealSoft}
      icon={<Ionicons name="heart-outline" size={13} color={colors.teal} />}
      title={HEALTH_LABEL}
      footerLabel="View health data"
      onPress={() => onPress()}
    >
      <View style={styles.ahMiniPills}>
        <Pressable
          style={({ pressed }) => [
            styles.ahMiniPill,
            styles.ahMiniPillSleep,
            pressed && styles.ahMiniPillPressed,
          ]}
          onPress={() => onPress("sleep")}
        >
          <Ionicons name="moon-outline" size={12} color={colors.blue} />
          <AppText style={styles.ahMiniPillMetric}>Sleep</AppText>
          <AppText style={styles.ahMiniPillValue}>{sleepVal}</AppText>
          <Ionicons name="chevron-forward" size={10} color={colors.subtle} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.ahMiniPill,
            styles.ahMiniPillSteps,
            pressed && styles.ahMiniPillPressed,
          ]}
          onPress={() => onPress("steps")}
        >
          <Ionicons name="walk-outline" size={12} color={colors.green} />
          <AppText style={styles.ahMiniPillMetric}>Steps</AppText>
          <AppText style={styles.ahMiniPillValue}>{stepsVal}</AppText>
          <Ionicons name="chevron-forward" size={10} color={colors.subtle} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.ahMiniPill,
            styles.ahMiniPillHR,
            pressed && styles.ahMiniPillPressed,
          ]}
          onPress={() => onPress("heartRate")}
        >
          <Ionicons name="heart-outline" size={12} color={colors.orange} />
          <AppText style={styles.ahMiniPillMetric}>Heart Rate</AppText>
          <View style={styles.ahMiniPillValueWrap}>
            <AppText style={styles.ahMiniPillValue}>{hrVal}</AppText>
            {heartRate != null && (
              <AppText style={styles.ahMiniPillUnit}> bpm</AppText>
            )}
          </View>
          <Ionicons name="chevron-forward" size={10} color={colors.subtle} />
        </Pressable>
      </View>
    </HomeFeatureCard>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.md,
  },

  // Greeting
  greeting: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greetLeft: {
    flex: 1,
    gap: 3,
    marginRight: spacing.sm,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.teal,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  profileAvatarImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    borderRadius: 9999,
  },
  profileAvatarText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: "#fff",
    letterSpacing: 0.5,
  },
  greetDate: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  greetTitle: {
    color: c.text,
  },

  // SHIN Score ring card
  heroCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  heroPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  heroLabelBlock: {
    flex: 1,
    gap: 3,
    marginRight: spacing.xs,
  },
  heroLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  heroLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.teal,
    letterSpacing: 1.2,
  },
  staleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  staleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.warning,
  },
  staleLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.warning,
  },
  heroSub: {
    fontSize: typescale.size.xs,
    color: c.muted,
  },
  labelPill: {
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 140,
    flexShrink: 0,
  },
  labelPillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },
  labelPillMuted: {
    backgroundColor: c.bgSecondary,
  },
  labelPillTextMuted: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.muted,
  },
  ringWrap: {
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  ringPlaceholder: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  ringPlaceholderText: {
    fontSize: typescale.size.sm,
    color: c.muted,
  },
  emptyScore: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyScoreRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: c.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyScoreTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  emptyScoreBody: {
    fontSize: typescale.size.xs,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // AI Health Summary card
  summaryCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    ...shadows.xs,
  },
  summaryPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  summaryAccent: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: c.teal,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    marginRight: spacing.xs,
    flexShrink: 0,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  summaryTextBlock: {
    flex: 1,
    gap: 3,
  },
  summaryTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  summarySub: {
    fontSize: typescale.size.xs,
    color: c.muted,
  },

  // Dual card row
  dualCardRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },

  // AI Suggestions
  suggestionList: {
    gap: 0,
    flex: 1,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingVertical: 7,
  },
  suggestionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
  },
  suggestionText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: c.textSub,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Apple Health mini — not connected
  ahMiniEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  // Dashed border signals "needs action" — mirrors the empty score ring
  ahMiniEmptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  ahMiniEmptyLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textAlign: "center",
  },
  ahMiniEmptySub: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Connected pills
  ahMiniPills: {
    gap: spacing.xs,
  },
  ahMiniPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    gap: spacing.xs,
    minHeight: 36,
  },
  ahMiniPillSleep: {
    backgroundColor: c.blueSoft,
  },
  ahMiniPillSteps: {
    backgroundColor: c.greenSoft,
  },
  ahMiniPillHR: {
    backgroundColor: c.orangeSoft,
  },
  ahMiniPillPressed: {
    opacity: 0.6,
  },
  ahMiniPillMetric: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.medium,
    color: c.textSub,
  },
  ahMiniPillValueWrap: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  ahMiniPillValue: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  ahMiniPillUnit: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.medium,
    color: c.muted,
  },

  // AI Suggestions — loading state
  aiLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },

  // AI Suggestions — empty/fallback state
  aiEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  aiEmptyText: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Priority-colored bullet dot
  suggestionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
    flexShrink: 0,
  },

  actionsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    gap: spacing.xxs,
    ...shadows.xs,
  },
  quickPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  quickIconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
    textAlign: "center",
  },

  // ── Feature card shell styles ──────────────────────────────────────────────
  fcard_card: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    borderTopWidth: 3,
    // borderTopColor applied inline via accentColor prop
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  fcard_pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  fcard_header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  fcard_iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  fcard_title: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.text,
    letterSpacing: 0.2,
  },
  // Grows to fill space between header and footer, keeping footer at bottom
  // when sibling card is taller and stretches this card's height.
  fcard_body: {
    flex: 1,
  },
  fcard_footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
  },
  fcard_footerText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    // color applied inline via footerColor prop
  },
}));
