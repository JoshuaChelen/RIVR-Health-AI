import React from "react";
import { View, StyleSheet, ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { createStyles } from "../../../theme/createStyles";
import { OfflineBanner } from "./OfflineBanner";

type ScreenProps = ViewProps & {
  edges?: Edge[];
};

export function Screen({
  style,
  edges = ["top", "right", "bottom", "left"],
  ...props
}: ScreenProps) {
  const styles = useStyles();
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      <OfflineBanner />
      <View {...props} style={[styles.container, style]} />
    </SafeAreaView>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  container: { flex: 1, backgroundColor: c.bg },
}));