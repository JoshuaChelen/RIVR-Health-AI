import React from "react";
import { Text, TextProps, StyleSheet } from "react-native";
import { colors, fonts } from "../../../theme/tokens";

type Variant = "h1" | "h2" | "title" | "body" | "muted" | "label" | "caption";

type Props = TextProps & {
  variant?: Variant;
};

export function AppText({ variant = "body", style, ...props }: Props) {
  return <Text {...props} style={[styles.base, styles[variant], style]} />;
}

const styles = StyleSheet.create({
  base: {
    fontFamily: fonts.regular,
    color: colors.text,
  },

  h1: { fontSize: 20, fontWeight: "800", color: colors.text, fontFamily: fonts.bold },
  h2: { fontSize: 16, fontWeight: "800", color: colors.text, fontFamily: fonts.bold },
  title: { fontSize: 14.5, fontWeight: "800", color: colors.text, fontFamily: fonts.bold },

  body: { fontSize: 14, fontWeight: "600", color: colors.text, fontFamily: fonts.semibold },
  muted: { fontSize: 13, fontWeight: "600", color: colors.muted, fontFamily: fonts.semibold },

  label: { fontSize: 12, fontWeight: "800", color: colors.muted, letterSpacing: 0.3, fontFamily: fonts.bold },
  caption: { fontSize: 12, fontWeight: "600", color: colors.subtle, fontFamily: fonts.semibold },
});
