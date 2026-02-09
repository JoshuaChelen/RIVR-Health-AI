import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { colors } from "../../../theme/tokens";

type Props = {
  size?: number; // default 56 matches Login
  style?: StyleProp<ViewStyle>;
};

export function AuthLogo({ size = 56, style }: Props) {
  const borderRadius = 20; // matches your Login look
  const innerSize = 16;    // matches your Login look

  return (
    <View
      style={[
        styles.logoDot,
        { width: size, height: size, borderRadius },
        style,
      ]}
    >
      <View
        style={[
          styles.logoInner,
          { width: innerSize, height: innerSize, borderRadius: innerSize / 2 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  logoDot: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  logoInner: {
    backgroundColor: colors.teal,
  },
});
