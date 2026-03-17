import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors, shadows } from "../../../theme/tokens";

type Props = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function AuthLogo({ size = 64, style }: Props) {
  const iconSize = Math.round(size * 0.44);

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size * 0.3 },
        style,
      ]}
    >
      {/* Simple medical cross / pulse mark */}
      <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        {/* Vertical bar of cross */}
        <Path
          d="M10 3h4v7H3v4h11v7h-4"
          stroke={colors.teal}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Horizontal bar of cross */}
        <Path
          d="M3 10h18v4H3z"
          fill={colors.tealSoft}
          stroke={colors.teal}
          strokeWidth={0}
        />
        {/* Cross shape */}
        <Path
          d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7V3z"
          fill={colors.teal}
          opacity={0.9}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.tealBorder,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
});
