import React from "react";
import { View, Image, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { logoIconFullcolor } from "../../../lib/branding";

type Props = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function AuthLogo({ size = 64, style }: Props) {
  const styles = useStyles();
  const imageSize = Math.round(size * 0.72);

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size * 0.3 },
        style,
      ]}
      accessible
      accessibilityLabel="RIVR Health logo"
      accessibilityRole="image"
    >
      <Image
        source={logoIconFullcolor}
        style={{ width: imageSize, height: imageSize }}
        resizeMode="contain"
        accessible={false}
      />
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  container: {
    backgroundColor: c.surface,
    borderWidth: 1.5,
    borderColor: c.tealBorder,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
}));
