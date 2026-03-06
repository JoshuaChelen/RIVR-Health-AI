import React from "react";
import { SafeAreaView, View, StyleSheet, ViewProps } from "react-native";
import { colors } from "../../../theme/tokens";

export function Screen({ style, ...props }: ViewProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View {...props} style={[styles.container, style]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
});
