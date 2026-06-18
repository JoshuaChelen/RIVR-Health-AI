/**
 * SECURITY INVARIANT — XSS-safe text rendering.
 *
 * React Native's <Text> component renders content as plain text and has no
 * concept of innerHTML.  All server/LLM-generated content (health summaries,
 * QA answers, extracted fields) is safe to pass as children here — HTML tags
 * and script content are rendered as literal characters, not executed.
 *
 * Rules to maintain this invariant:
 *   - NEVER use dangerouslySetInnerHTML (not applicable in RN, but guard if
 *     this component is ever ported to a React DOM context).
 *   - NEVER add a markdown renderer without sanitization (e.g. DOMPurify).
 *   - NEVER render raw HTML from the backend directly to the DOM.
 *
 * Verified by: src/components/ui/Primitives/AppText.test.ts
 */

import React from "react";
import { Text, TextProps, StyleSheet } from "react-native";
import { fonts, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Variant =
  | "h1"
  | "h2"
  | "title"
  | "body"
  | "muted"
  | "label"
  | "caption";

type Props = TextProps & {
  variant?: Variant;
};

export function AppText({ variant = "body", style, ...props }: Props) {
  const styles = useStyles();
  return <Text {...props} style={[styles.base, styles[variant], style]} />;
}

const useStyles = createStyles((c) => StyleSheet.create({
  base: {
    fontFamily: fonts.regular,
    color: c.text,
  },

  h1: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.extrabold,
    color: c.text,
    lineHeight: typescale.size.xl * typescale.lineHeight.tight,
    fontFamily: fonts.bold,
  },
  h2: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
    lineHeight: typescale.size.lg * typescale.lineHeight.tight,
    fontFamily: fonts.bold,
  },
  title: {
    fontSize: typescale.size.md,
    fontWeight: typescale.weight.bold,
    color: c.text,
    lineHeight: typescale.size.md * typescale.lineHeight.normal,
    fontFamily: fonts.bold,
  },
  body: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
    color: c.text,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    fontFamily: fonts.semibold,
  },
  muted: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    fontFamily: fonts.semibold,
  },
  label: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: fonts.bold,
  },
  caption: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium,
    color: c.subtle,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
    fontFamily: fonts.semibold,
  },
}));
