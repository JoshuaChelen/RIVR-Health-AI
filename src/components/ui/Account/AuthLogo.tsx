import React from "react";
import { View, Image, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { colors, shadows } from "../../../theme/tokens";
import { logoIconFullcolor } from "../../../lib/branding";

type Props = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function AuthLogo({ size = 64, style }: Props) {
  const imageSize = Math.round(size * 0.72);

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size * 0.3 },
        style,
      ]}
    >
      <Image
        source={logoIconFullcolor}
        style={{ width: imageSize, height: imageSize }}
        resizeMode="contain"
      />
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
