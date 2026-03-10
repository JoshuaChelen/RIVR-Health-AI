import React from "react";
import { View, StyleSheet } from "react-native";
import { AppText } from "./AppText";
import { colors, radius, spacing, typescale } from "../../../theme/tokens";

type Props = { message: string | null };

export function ErrorBanner({ message }: Props) {
  if (!message) return null;
  return (
    <View style={styles.banner}>
      <AppText style={styles.text}>{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  text: {
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium as any,
  },
});
