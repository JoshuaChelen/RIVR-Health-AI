import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { AppText } from "../Primitives/AppText";
import { colors, typescale } from "../../../theme/tokens";

function scoreLabel(value: number): string {
  if (value >= 85) return "Excellent";
  if (value >= 70) return "Good";
  if (value >= 55) return "Fair";
  return "Needs attention";
}

export function ScoreRing({ value }: { value: number }) {
  const size   = 180;
  const stroke = 14;
  const r      = (size - stroke) / 2;
  const c      = 2 * Math.PI * r;
  const pct    = Math.max(0, Math.min(100, value));
  const dash   = (pct / 100) * c;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0"    stopColor={colors.teal} />
            <Stop offset="0.6"  stopColor={colors.tealMid} />
            <Stop offset="1"    stopColor={colors.green} />
          </LinearGradient>
        </Defs>

        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.bgSecondary}
          strokeWidth={stroke}
          fill="transparent"
        />

        {/* Progress */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#scoreGrad)"
          strokeWidth={stroke}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${dash}, ${c}`}
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>

      <View style={styles.center}>
        <AppText style={styles.score}>{value}</AppText>
        <AppText variant="muted" style={styles.label}>{scoreLabel(value)}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  score: {
    fontSize: typescale.size.hero + 8,
    fontWeight: typescale.weight.black,
    color: colors.text,
    lineHeight: (typescale.size.hero + 8) * 1.1,
  },
  label: {
    marginTop: 2,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
});
