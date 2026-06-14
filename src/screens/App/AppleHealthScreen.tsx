import React, { useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Rect, Path, Circle } from "react-native-svg";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { spacing, radius, typescale, shadows } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  useAppleHealth,
  type DailyDataPoint,
  type AppleHealthStatus,
} from "../../context/AppleHealthContext";
import { openHealthSettings } from "../../lib/health/healthkit";

// On Android the underlying provider is Health Connect (which Samsung Health
// syncs into); on iOS it's Apple Health.
const HEALTH_LABEL = Platform.OS === "android" ? "Health Connect" : "Apple Health";

type Props = NativeStackScreenProps<AppStackParamList, "AppleHealth">;
type AHStatus = AppleHealthStatus;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSteps(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtDistance(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} mi`;
}

function fmtKcal(n: number | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString()} kcal`;
}

function fmtLastSync(d: Date | null): string {
  if (!d) return "Not yet synced";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ─── SVG Charts ───────────────────────────────────────────────────────────────

const CHART_BASE_W = 240;

function MiniBarChart({
  data,
  color,
  height = 44,
}: {
  data: DailyDataPoint[];
  color: string;
  height?: number;
}) {
  if (!data.length) return null;
  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  if (max === 0) return null;

  const barCount = data.length;
  const gap = 3;
  const barW = Math.max(4, (CHART_BASE_W - gap * (barCount - 1)) / barCount);

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${CHART_BASE_W} ${height}`}
      preserveAspectRatio="none"
    >
      {data.map((point, i) => {
        const barH = Math.max(2, (point.value / max) * height);
        const x = i * (barW + gap);
        const y = height - barH;
        return (
          <Rect
            key={`${point.date}-${i}`}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={2}
            fill={color}
            opacity={0.75}
          />
        );
      })}
    </Svg>
  );
}

function MiniLineChart({
  data,
  color,
  height = 44,
}: {
  data: DailyDataPoint[];
  color: string;
  height?: number;
}) {
  if (data.length < 2) {
    // Single dot fallback
    if (data.length === 1) {
      return (
        <Svg width="100%" height={height} viewBox={`0 0 ${CHART_BASE_W} ${height}`}>
          <Circle cx={CHART_BASE_W / 2} cy={height / 2} r={4} fill={color} opacity={0.7} />
        </Svg>
      );
    }
    return null;
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pad = 4;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * CHART_BASE_W;
    const y = height - pad - ((d.value - min) / range) * (height - pad * 2);
    return { x, y };
  });

  const pathD =
    `M ${pts[0].x} ${pts[0].y} ` +
    pts
      .slice(1)
      .map((p) => `L ${p.x} ${p.y}`)
      .join(" ");

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${CHART_BASE_W} ${height}`}
      preserveAspectRatio="none"
    >
      <Path
        d={pathD}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Endpoint dot */}
      <Circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={3}
        fill={color}
      />
    </Svg>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function AppleHealthScreen({ route }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const initialMetric = route.params?.initialMetric;

  const scrollRef = useRef<ScrollView>(null);
  const metricsLayoutY = useRef<number>(0);

  const {
    status,
    refreshing,
    heartRate,
    sleepAvgText,
    stepsAvg7d,
    walkingRunningDistanceAvg7dMiles,
    activeEnergyAvg7dKcal,
    stepsTrend7d,
    sleepTrend7d,
    heartRateTrend,
    lastSync,
    errorText,
    link,
    refresh,
    disconnect,
  } = useAppleHealth();

  const isLinkedClean = status === "linked" && !errorText;
  const isLinkedWithWarning = status === "linked" && !!errorText;
  const isLinked = isLinkedClean || isLinkedWithWarning;

  // Scroll to metrics when arriving via a specific metric pill from Home
  useEffect(() => {
    if (!initialMetric || !isLinked) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, metricsLayoutY.current - 16),
        animated: true,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [initialMetric, isLinked]);

  const onMetricsLayout = (e: LayoutChangeEvent) => {
    metricsLayoutY.current = e.nativeEvent.layout.y;
  };

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Status hero ────────────────────────────────── */}
        <StatusHero
          status={status as AHStatus}
          isLinkedClean={isLinkedClean}
          isLinkedWithWarning={isLinkedWithWarning}
          errorText={errorText}
        />

        {/* ── Error banner ──────────────────────────────────── */}
        {errorText && !isLinkedWithWarning ? (
          <ErrorBanner message="Couldn't load Apple Health data" onRetry={refresh} />
        ) : null}

        {/* ── Unsupported info card ────────────────────────── */}
        {status === "unsupported" && (
          <View style={styles.infoCard}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="phone-portrait-outline" size={28} color={colors.muted} />
            </View>
            <AppText style={styles.infoTitle}>
              {Platform.OS === "android" ? "Health Connect unavailable" : "iPhone required"}
            </AppText>
            <AppText style={styles.infoBody}>
              {Platform.OS === "android"
                ? "Health Connect isn't available on this device. On Android 13 and below, install it from the Play Store, then try again."
                : "Apple Health is only available on iPhone. This feature isn't accessible on this device or build."}
            </AppText>
          </View>
        )}

        {/* ── Unlinked invite card ─────────────────────────── */}
        {status === "unlinked" && (
          <View style={styles.inviteCard}>
            <View style={styles.inviteIconWrap}>
              <Ionicons name="heart-outline" size={28} color={colors.teal} />
            </View>
            <AppText style={styles.inviteTitle}>Sync your vitals</AppText>
            <AppText style={styles.inviteBody}>
              Connect Apple Health to automatically sync your steps, sleep, heart rate, and more. Your data stays on your device — RIVR never writes to Apple Health.
            </AppText>
          </View>
        )}

        {/* ── Disconnected guide card ──────────────────────── */}
        {status === "disconnected" && (
          <View style={styles.disconnectGuide}>
            <View style={styles.disconnectGuideHeader}>
              <Ionicons name="settings-outline" size={16} color={colors.textSub} />
              <AppText style={styles.disconnectGuideTitle}>How to re-enable access</AppText>
            </View>
            <AppText style={styles.disconnectGuideBody}>
              Go to Settings → Privacy &amp; Security → Health → RIVR Health and enable all data types.
            </AppText>
          </View>
        )}

        {/* ── 2. Dashboard (linked only) ────────────────────── */}
        {isLinked && (
          <View style={styles.metricsSection} onLayout={onMetricsLayout}>
            <AppText style={styles.sectionEyebrow}>Live Metrics</AppText>

            {/* Heart Rate */}
            <MetricChartCard
              iconName="heart-outline"
              iconColor={colors.orange}
              iconBg={colors.orangeSoft}
              label="Heart Rate"
              subtitle="Latest reading"
              value={heartRate != null ? `${heartRate} bpm` : "—"}
              highlighted={initialMetric === "heartRate"}
              chart={
                heartRateTrend.length > 0 ? (
                  <MiniLineChart data={heartRateTrend} color={colors.orange} />
                ) : null
              }
              chartLabel={heartRateTrend.length > 0 ? "Recent readings" : undefined}
            />

            {/* Sleep */}
            <MetricChartCard
              iconName="moon-outline"
              iconColor={colors.blue}
              iconBg={colors.blueSoft}
              label="Sleep"
              subtitle="7-day average"
              value={sleepAvgText}
              highlighted={initialMetric === "sleep"}
              chart={
                sleepTrend7d.length > 0 ? (
                  <MiniBarChart data={sleepTrend7d} color={colors.blue} />
                ) : null
              }
              chartLabel={
                sleepTrend7d.length > 0
                  ? `${sleepTrend7d.length} nights tracked`
                  : undefined
              }
            />

            {/* Steps */}
            <MetricChartCard
              iconName="walk-outline"
              iconColor={colors.green}
              iconBg={colors.greenSoft}
              label="Steps"
              subtitle="7-day average"
              value={fmtSteps(stepsAvg7d)}
              highlighted={initialMetric === "steps"}
              chart={
                stepsTrend7d.length > 0 ? (
                  <MiniBarChart data={stepsTrend7d} color={colors.green} />
                ) : null
              }
              chartLabel={stepsTrend7d.length > 0 ? "Last 7 days" : undefined}
            />

            {/* Distance */}
            <MetricChartCard
              iconName="map-outline"
              iconColor={colors.teal}
              iconBg={colors.tealSoft}
              label="Distance"
              subtitle="7-day average"
              value={fmtDistance(walkingRunningDistanceAvg7dMiles)}
            />

            {/* Active Energy */}
            <MetricChartCard
              iconName="flame-outline"
              iconColor="#E05D2B"
              iconBg="#FEF0EA"
              label="Active Energy"
              subtitle="7-day average"
              value={fmtKcal(activeEnergyAvg7dKcal)}
            />
          </View>
        )}

        {/* ── 3. Actions ────────────────────────────────────── */}

        {status === "unlinked" && (
          <PrimaryButton
            label={refreshing ? "Connecting…" : `Connect ${HEALTH_LABEL}`}
            onPress={link}
            disabled={refreshing}
          />
        )}

        {status === "disconnected" && (
          <View style={styles.actionsStack}>
            <PrimaryButton
              label={refreshing ? "Reconnecting…" : `Reconnect ${HEALTH_LABEL}`}
              onPress={link}
              disabled={refreshing}
            />
            <SecondaryButton
              label={Platform.OS === "android" ? "Open Health Connect" : "Open iPhone Settings"}
              onPress={() => openHealthSettings()}
            />
          </View>
        )}

        {isLinked && (
          <ActionsCard
            lastSync={lastSync}
            refreshing={refreshing}
            onRefresh={refresh}
            onDisconnect={disconnect}
          />
        )}

        {/* ── 4. Footer ─────────────────────────────────────── */}
        <AppText style={styles.footer}>
          RIVR reads heart rate, sleep, steps, distance, and active energy — and
          never writes to Apple Health.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

// ─── StatusHero ───────────────────────────────────────────────────────────────

type StatusHeroProps = {
  status: AHStatus;
  isLinkedClean: boolean;
  isLinkedWithWarning: boolean;
  errorText: string | null;
};

function StatusHero({
  status,
  isLinkedClean,
  isLinkedWithWarning,
  errorText,
}: StatusHeroProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  let iconName: React.ComponentProps<typeof Ionicons>["name"] = "heart-outline";
  let iconColor = colors.teal;
  let iconBg = colors.tealSoft;
  let badgeLabel = "";
  let badgeTextColor = colors.muted;
  let badgeBgColor = colors.bgSecondary;
  let subtitle = "";
  let showSpinner = false;

  if (status === "loading") {
    showSpinner = true;
    iconColor = colors.muted;
    iconBg = colors.bgSecondary;
    badgeLabel = "Checking…";
    subtitle = "Checking Apple Health status.";
  } else if (isLinkedClean) {
    iconName = "checkmark-circle";
    iconColor = colors.success;
    iconBg = colors.successSoft;
    badgeLabel = "Connected";
    badgeTextColor = colors.success;
    badgeBgColor = colors.successSoft;
    subtitle = "Syncing heart rate, sleep, steps, distance, and active energy.";
  } else if (isLinkedWithWarning) {
    iconName = "warning-outline";
    iconColor = colors.warning;
    iconBg = colors.warnSoft;
    badgeLabel = "Authorized";
    badgeTextColor = colors.warning;
    badgeBgColor = colors.warnSoft;
    subtitle = "Authorized — waiting for Apple Health data.";
  } else if (status === "unlinked") {
    iconName = "link-outline";
    iconColor = colors.teal;
    iconBg = colors.tealSoft;
    badgeLabel = "Not connected";
    subtitle = "Connect Apple Health to view live vitals in RIVR.";
  } else if (status === "disconnected") {
    iconName = "link-outline";
    iconColor = colors.muted;
    iconBg = colors.bgSecondary;
    badgeLabel = "Disconnected";
    subtitle = "RIVR is no longer reading your Apple Health data.";
  } else if (status === "unsupported") {
    iconName = "phone-portrait-outline";
    iconColor = colors.muted;
    iconBg = colors.bgSecondary;
    badgeLabel = "Unavailable";
    subtitle = "Apple Health is not available on this device or build.";
  }

  return (
    <View style={styles.hero_card}>
      <View style={styles.hero_topRow}>
        <View style={[styles.hero_iconWrap, { backgroundColor: iconBg }]}>
          {showSpinner ? (
            <ActivityIndicator size="small" color={colors.muted} accessibilityLabel="Checking Apple Health status" />
          ) : (
            <Ionicons name={iconName} size={20} color={iconColor} />
          )}
        </View>

        <AppText style={styles.hero_title}>{HEALTH_LABEL}</AppText>

        <View style={[styles.hero_badge, { backgroundColor: badgeBgColor }]}>
          <AppText style={[styles.hero_badgeText, { color: badgeTextColor }]}>
            {badgeLabel}
          </AppText>
        </View>
      </View>

      <AppText style={styles.hero_subtitle}>{subtitle}</AppText>

      {errorText ? (
        <View
          style={[
            styles.hero_alertRow,
            isLinkedWithWarning ? styles.hero_alertRowWarn : styles.hero_alertRowError,
          ]}
        >
          <Ionicons
            name={isLinkedWithWarning ? "warning-outline" : "alert-circle-outline"}
            size={13}
            color={isLinkedWithWarning ? colors.warning : colors.danger}
          />
          <AppText
            style={[
              styles.hero_alertText,
              { color: isLinkedWithWarning ? colors.warning : colors.danger },
            ]}
          >
            {errorText}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

// ─── MetricChartCard ──────────────────────────────────────────────────────────

function MetricChartCard({
  iconName,
  iconColor,
  iconBg,
  label,
  subtitle,
  value,
  secondaryValue,
  highlighted,
  chart,
  chartLabel,
}: {
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  iconBg: string;
  label: string;
  subtitle: string;
  value: string;
  secondaryValue?: string;
  highlighted?: boolean;
  chart?: React.ReactNode;
  chartLabel?: string;
}) {
  const styles = useStyles();

  return (
    <View style={[styles.mcc_card, highlighted && styles.mcc_cardHighlighted]}>
      {/* Header row: icon + labels + value */}
      <View style={styles.mcc_header}>
        <View style={[styles.mcc_iconWrap, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName} size={20} color={iconColor} />
        </View>

        <View style={styles.mcc_textBlock}>
          <AppText style={styles.mcc_label}>{label}</AppText>
          <AppText style={styles.mcc_subtitle}>{subtitle}</AppText>
          {secondaryValue ? (
            <AppText style={styles.mcc_secondaryValue}>{secondaryValue}</AppText>
          ) : null}
        </View>

        <AppText style={styles.mcc_value} numberOfLines={1}>
          {value}
        </AppText>
      </View>

      {/* Chart + chart label below header */}
      {chart ? (
        <View style={styles.mcc_chartBlock}>
          <View style={styles.mcc_chartArea}>{chart}</View>
          {chartLabel ? (
            <AppText style={styles.mcc_chartLabel}>{chartLabel}</AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── ActionsCard ──────────────────────────────────────────────────────────────

function ActionsCard({
  lastSync,
  refreshing,
  onRefresh,
  onDisconnect,
}: {
  lastSync: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.ac_card}>
      <View style={styles.ac_syncRow}>
        <View style={styles.ac_syncLeft}>
          <Ionicons name="sync-outline" size={14} color={colors.muted} />
          <AppText style={styles.ac_syncText}>
            {lastSync ? `Last synced ${fmtLastSync(lastSync)}` : "Not yet synced"}
          </AppText>
        </View>
        <SecondaryButton
          label={refreshing ? "Refreshing…" : "Refresh"}
          onPress={onRefresh}
          disabled={refreshing}
          style={styles.ac_refreshBtn}
        />
      </View>

      <View style={styles.ac_divider} />

      <SecondaryButton
        label={refreshing ? "Disconnecting…" : "Disconnect Apple Health"}
        onPress={onDisconnect}
        disabled={refreshing}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
  // ── Hero ────────────────────────────────────────────────────────────────
  hero_card: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  hero_topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  hero_iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  hero_title: {
    flex: 1,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  hero_badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    flexShrink: 0,
  },
  hero_badgeText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },
  hero_subtitle: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingLeft: 40 + spacing.sm,
  },
  hero_alertRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  hero_alertRowWarn: {
    backgroundColor: c.warnSoft,
  },
  hero_alertRowError: {
    backgroundColor: c.dangerSoft,
  },
  hero_alertText: {
    flex: 1,
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.medium,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // ── MetricChartCard (mcc) ───────────────────────────────────────────────
  mcc_card: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.xs,
  },
  mcc_cardHighlighted: {
    borderColor: c.tealBorder,
    backgroundColor: c.tealSoft,
  },
  mcc_header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  mcc_iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  mcc_textBlock: {
    flex: 1,
    gap: 3,
  },
  mcc_label: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: c.text,
  },
  mcc_subtitle: {
    fontSize: typescale.size.xs,
    color: c.muted,
  },
  mcc_secondaryValue: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    marginTop: 1,
  },
  mcc_value: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold,
    color: c.text,
    flexShrink: 0,
    textAlign: "right",
  },
  mcc_chartBlock: {
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
  },
  mcc_chartArea: {
    height: 44,
    overflow: "hidden",
  },
  mcc_chartLabel: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    textAlign: "right",
  },

  // ── ActionsCard (ac) ───────────────────────────────────────────────────
  ac_card: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.xs,
  },
  ac_syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  ac_syncLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  ac_syncText: {
    fontSize: typescale.size.xs,
    color: c.muted,
  },
  ac_refreshBtn: {
    height: 36,
    paddingHorizontal: spacing.md,
    flexShrink: 0,
  },
  ac_divider: {
    height: 1,
    backgroundColor: c.borderLight,
    marginVertical: spacing.xxs,
  },

  // ── Main styles ─────────────────────────────────────────────────────────
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl + spacing.lg,
  },

  // Unsupported info card
  infoCard: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.bgSecondary,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.xl,
  },
  infoIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  infoBody: {
    fontSize: typescale.size.sm,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Unlinked invite card
  inviteCard: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.tealSoft,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.tealBorder,
    padding: spacing.xl,
  },
  inviteIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.tealBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  inviteBody: {
    fontSize: typescale.size.sm,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Disconnected guide card
  disconnectGuide: {
    backgroundColor: c.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  disconnectGuideHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  disconnectGuideTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
  },
  disconnectGuideBody: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  sectionEyebrow: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  metricsSection: {
    gap: spacing.xs,
  },
  actionsStack: {
    gap: spacing.xs,
  },
  footer: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
}));
