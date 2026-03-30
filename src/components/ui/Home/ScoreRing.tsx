import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { AppText } from "../Primitives/AppText";
import { typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

function scoreLabel(value: number): string {
  if (value >= 85) return "Excellent";
  if (value >= 70) return "Good";
  if (value >= 55) return "Fair";
  return "Needs attention";
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Build an SVG arc path starting from the top (12 o'clock), sweeping clockwise
 * by `angleDeg` degrees.  Works correctly for any value 0 < angleDeg < 360.
 */
function buildArcPath(cx: number, cy: number, r: number, angleDeg: number): string {
  if (angleDeg <= 0) {
    // Return a degenerate path that draws nothing visible
    return `M ${cx} ${cy - r} L ${cx} ${cy - r}`;
  }

  // Clamp to avoid the degenerate "full circle" arc case (start === end)
  const deg = Math.min(angleDeg, 359.99);

  const startRad = -Math.PI / 2;                          // top (12 o'clock)
  const endRad   = startRad + (deg * Math.PI) / 180;      // clockwise by deg

  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);

  const largeArc = deg > 180 ? 1 : 0;

  // Sweep = 1 → clockwise direction
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

const SIZE   = 180;
const STROKE = 14;
const R      = (SIZE - STROKE) / 2;
const CX     = SIZE / 2;
const CY     = SIZE / 2;

export function ScoreRing({ value }: { value: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const pct         = Math.max(0, Math.min(100, value));
  const targetAngle = pct * 3.6;   // 0–100  →  0–360 degrees

  const [angle, setAngle] = useState(0);
  const rafRef   = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unique gradient ID per instance so multiple ScoreRings don't conflict
  const gradId = useRef(`sgr_${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    if (rafRef.current)   cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);

    setAngle(0);

    const duration = 1100;
    const endAngle = targetAngle;

    timerRef.current = setTimeout(() => {
      const startTime = Date.now();

      const tick = () => {
        const t = Math.min((Date.now() - startTime) / duration, 1);
        setAngle(easeOutCubic(t) * endAngle);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    }, 200);

    return () => {
      if (rafRef.current)   cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [targetAngle]);

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`SHIN Score: ${value} out of 100, ${scoreLabel(value)}`}
    >
      <Svg width={SIZE} height={SIZE}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0"   stopColor={colors.teal} />
            <Stop offset="0.6" stopColor={colors.tealMid} />
            <Stop offset="1"   stopColor={colors.green} />
          </LinearGradient>
        </Defs>

        {/* Gray track — full circle */}
        <Circle
          cx={CX}
          cy={CY}
          r={R}
          stroke={colors.bgSecondary}
          strokeWidth={STROKE}
          fill="transparent"
        />

        {/* Teal progress arc — drawn as a Path so no strokeDasharray needed */}
        <Path
          d={buildArcPath(CX, CY, R, angle)}
          stroke={`url(#${gradId})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>

      <View style={styles.center}>
        <AppText style={styles.score}>{value}</AppText>
        <AppText variant="muted" style={styles.label}>{scoreLabel(value)}</AppText>
      </View>
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
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
    color: c.text,
    lineHeight: (typescale.size.hero + 8) * 1.1,
  },
  label: {
    marginTop: 2,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },
}));
