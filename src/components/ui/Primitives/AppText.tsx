import React from "react";
import { Text, TextProps, StyleSheet } from "react-native";
import { colors, fonts, typescale } from "../../../theme/tokens";

type Variant =
  | "h1"
  | "h2"
  | "title"
  | "body"
  | "muted"
  | "label"
  | "caption"
  | "mono";

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

  h1: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.extrabold,
    color: colors.text,
    lineHeight: typescale.size.xl * typescale.lineHeight.tight,
    fontFamily: fonts.bold,
  },
  h2: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    lineHeight: typescale.size.lg * typescale.lineHeight.tight,
    fontFamily: fonts.bold,
  },
  title: {
    fontSize: typescale.size.md,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    lineHeight: typescale.size.md * typescale.lineHeight.normal,
    fontFamily: fonts.bold,
  },
  body: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
    color: colors.text,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    fontFamily: fonts.semibold,
  },
  muted: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    fontFamily: fonts.semibold,
  },
  label: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: fonts.bold,
  },
  caption: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: colors.subtle,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
    fontFamily: fonts.semibold,
  },
  mono: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.regular,
    color: colors.text,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    fontFamily: fonts.regular,
  },
});
