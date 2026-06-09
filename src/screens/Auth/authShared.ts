// Shared entrance animation + base styles for the auth screens
// (Login / SignUp / ForgotPassword). All three use the same
// brand → form → footer layout with a staggered entrance and identical
// card/banner/footer styling. Screens merge their own unique styles on top:
//   const styles = { ...useAuthStyles(), ...useStyles() };
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";

/** Staggered header → form → footer entrance; runs once on mount. */
export function useAuthEntrance() {
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide   = useRef(new Animated.Value(16)).current;
  const formOpacity   = useRef(new Animated.Value(0)).current;
  const formSlide     = useRef(new Animated.Value(24)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(headerSlide,   { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(formOpacity, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(formSlide,   { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(footerOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [headerOpacity, headerSlide, formOpacity, formSlide, footerOpacity]);

  return { headerOpacity, headerSlide, formOpacity, formSlide, footerOpacity };
}

/** Base styles shared by the three auth screens. */
export const useAuthStyles = createStyles((c) => StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    justifyContent: "center",
  },
  inner: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: spacing.xl,
  },
  brand: {
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  appName: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.bold,
    color: c.text,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: typescale.size.base,
    color: c.muted,
    textAlign: "center",
  },
  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: 20,
  },
  fields: {
    gap: spacing.md,
  },
  errorBanner: {
    backgroundColor: c.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.dangerBorder,
  },
  errorText: {
    fontSize: typescale.size.sm,
    color: c.danger,
    fontWeight: typescale.weight.medium,
  },
  successBanner: {
    backgroundColor: c.successSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.successBorder,
  },
  successText: {
    fontSize: typescale.size.sm,
    color: c.success,
    fontWeight: typescale.weight.medium,
  },
  divider: {
    height: 1,
    backgroundColor: c.borderLight,
    marginVertical: spacing.xxs,
  },
  footer: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
}));
