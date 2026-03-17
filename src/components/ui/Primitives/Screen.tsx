import React from "react";
import { View, StyleSheet, ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors } from "../../../theme/tokens";

type ScreenProps = ViewProps & {
  edges?: Edge[];
};

export function Screen({
  style,
  edges = ["top", "right", "bottom", "left"],
  ...props
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      <View {...props} style={[styles.container, style]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
});