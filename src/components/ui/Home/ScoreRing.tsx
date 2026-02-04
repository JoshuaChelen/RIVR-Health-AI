import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { AppText } from "../Primitives/AppText";
import { colors } from "../../../theme/tokens";

export function ScoreRing({ value }: { value: number }) {
  const size = 170;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.teal} />
            <Stop offset="0.65" stopColor={colors.green} />
            <Stop offset="1" stopColor="#FACC15" />
          </LinearGradient>
        </Defs>

        {/* Background Circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.border}
          strokeWidth={stroke}
          fill="transparent"
        />

        {/* Progress Circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#g)"
          strokeWidth={stroke}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${dash}, ${c}`} 
          // Changed rotation to number and ensured origin is explicit
          rotation={-90} 
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>

      <View style={styles.center}>
        <AppText variant="h1" style={{ fontSize: 40, lineHeight: 48 }}>{value}</AppText>
        <AppText variant="muted" style={{ fontWeight: "800", marginTop: -4 }}>Good</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center", justifyContent: "center" },
});