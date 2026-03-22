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
import { supabase } from "../../lib/supabase";
import { getHealthProfile, getLatestEvaluation } from "../../lib/aiJobs";
import { getProfile } from "../../lib/profile";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ScoreRing } from "../../components/ui/Home/ScoreRing";
import { colors, spacing, radius, typescale, shadows } from "../../theme/tokens";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAppleHealth } from "../../context/AppleHealthContext";
import type { AppleHealthContextValue } from "../../context/AppleHealthContext";
import {
  buildRecommendations,
  PRIORITY_ACCENT,
  type RecommendationItem,
} from "../../lib/recommendations";
import { SectionHeader } from "../../components/ui/Timeline/SectionHeader";

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
  const [scoreLoading, setScoreLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [profileInitials, setProfileInitials] = useState<string | null>(null);
  const [aiRecommendations, setAiRecommendations] = useState<RecommendationItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        setScoreLoading(true);
        try {
          const { data: userRes } = await supabase.auth.getUser();
          if (!userRes?.user || !active) return;

          const userId = userRes.user.id;
          const [healthProfile, evalRow, userProfile] = await Promise.all([
            getHealthProfile(userId),
            getLatestEvaluation(userId),
            getProfile(userId),
          ]);

          if (!active) return;

          const evalResult = evalRow?.result ?? null;
          const resolvedScore =
            healthProfile?.score ?? evalResult?.score_0_to_100 ?? null;
          const resolvedLabel =
            healthProfile?.score_label ?? evalResult?.score_label ?? null;

          setScore(typeof resolvedScore === "number" ? resolvedScore : null);
          setLabel(typeof resolvedLabel === "string" ? resolvedLabel : null);

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
        } catch {
          // Silently fail on the dashboard — errors are surfaced on Health Summary
        } finally {
          if (active) setScoreLoading(false);
        }
      })();

      return () => {
        active = false;
      };
    }, [])
  );

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
            style={({ pressed }) => [
              styles.profileAvatar,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => navigation.navigate("Profile")}
          >
            <AppText style={styles.profileAvatarText}>
              {profileInitials ?? "·"}
            </AppText>
          </Pressable>
        </View>

        {/* ── SHIN Score ring card ───────────────────────────── */}
        <Pressable
          style={({ pressed }) => [
            styles.heroCard,
            pressed && styles.heroPressed,
          ]}
          onPress={() => navigation.navigate("ShinScore")}
        >
          <View style={styles.heroHeader}>
            <View style={styles.heroLabelBlock}>
              <AppText style={styles.heroLabel}>SHIN SCORE</AppText>
              <AppText style={styles.heroSub}>Overall health index</AppText>
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
                <ActivityIndicator color={colors.teal} size="large" />
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

        {/* ── Sign out ──────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [
            styles.signOut,
            pressed && { opacity: 0.5 },
          ]}
          onPress={async () => {
            await supabase.auth.signOut();
          }}
        >
          <AppText style={styles.signOutText}>Sign out</AppText>
        </Pressable>
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
  return (
    <Pressable
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
  footerColor = colors.teal,
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
  return (
    <Pressable
      style={({ pressed }) => [
        fcard.card,
        { borderTopColor: accentColor },
        pressed && fcard.pressed,
      ]}
      onPress={onPress}
    >
      {/* ── Header ─────────────────────────────────── */}
      <View style={fcard.header}>
        <View style={[fcard.iconWrap, { backgroundColor: iconBg }]}>
          {icon}
        </View>
        <AppText
          style={[fcard.title, titleColor ? { color: titleColor } : undefined]}
        >
          {title}
        </AppText>
        {headerAccessory}
        <Ionicons name="chevron-forward" size={13} color={colors.subtle} />
      </View>

      {/* ── Body — flex:1 keeps footer pinned to bottom ── */}
      <View style={fcard.body}>{children}</View>

      {/* ── Footer CTA ─────────────────────────────── */}
      <View style={fcard.footer}>
        <AppText style={[fcard.footerText, { color: footerColor }]}>
          {footerLabel}
        </AppText>
        <Ionicons name="arrow-forward" size={11} color={footerColor} />
      </View>
    </Pressable>
  );
}

// ─── Feature card shell styles ────────────────────────────────────────────────

const fcard = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 3,
    // borderTopColor applied inline via accentColor prop
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    letterSpacing: 0.2,
  },
  // Grows to fill space between header and footer, keeping footer at bottom
  // when sibling card is taller and stretches this card's height.
  body: {
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  footerText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    // color applied inline via footerColor prop
  },
});

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

function AppleHealthMiniCard({
  health,
  onPress,
}: {
  health: AppleHealthContextValue;
  onPress: (metric?: MetricKey) => void;
}) {
  const { status, heartRate, sleepAvgText, stepsAvg7d, sleepAvgMin } = health;
  const isConnected = status === "linked";

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <HomeFeatureCard
        accentColor={colors.border}
        iconBg={colors.bgSecondary}
        icon={<Ionicons name="heart-outline" size={13} color={colors.subtle} />}
        title="Apple Health"
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
      title="Apple Health"
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

const styles = StyleSheet.create({
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
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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
    color: colors.teal,
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  greetTitle: {
    color: colors.text,
  },

  // SHIN Score ring card
  heroCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
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
  heroLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    letterSpacing: 1.2,
  },
  heroSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  labelPill: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 140,
    flexShrink: 0,
  },
  labelPillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  labelPillMuted: {
    backgroundColor: colors.bgSecondary,
  },
  labelPillTextMuted: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.muted,
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
    color: colors.muted,
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
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyScoreTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  emptyScoreBody: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // AI Health Summary card
  summaryCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.teal,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    marginRight: spacing.xs,
    flexShrink: 0,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tealSoft,
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
    color: colors.text,
  },
  summarySub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
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
    borderBottomColor: colors.borderLight,
  },
  suggestionText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: colors.textSub,
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
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  ahMiniEmptyLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textAlign: "center",
  },
  ahMiniEmptySub: {
    fontSize: typescale.size.xs,
    color: colors.subtle,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Apple Health mini — connected
  ahMiniLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
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
    backgroundColor: colors.blueSoft,
  },
  ahMiniPillSteps: {
    backgroundColor: colors.greenSoft,
  },
  ahMiniPillHR: {
    backgroundColor: colors.orangeSoft,
  },
  ahMiniPillPressed: {
    opacity: 0.6,
  },
  ahMiniPillMetric: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.medium,
    color: colors.textSub,
  },
  ahMiniPillValueWrap: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  ahMiniPillValue: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  ahMiniPillUnit: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.medium,
    color: colors.muted,
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
    color: colors.subtle,
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

  // Sign out
  signOut: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  signOutText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: colors.subtle,
  },
  actionsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
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
    color: colors.textSub,
    textAlign: "center",
  },
});
