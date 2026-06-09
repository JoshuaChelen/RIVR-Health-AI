import { StyleSheet } from "react-native";
import { radius, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";

/**
 * Base styles shared by the three onboarding step screens. Screens merge their
 * own unique styles on top:
 *   const styles = { ...useOnboardingStyles(), ...useStyles() };
 */
export const useOnboardingStyles = createStyles((c) => StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  inner: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    gap: spacing.xl,
  },
  header: { gap: 6 },
  title: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.bold as any,
    color: c.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typescale.size.base,
    color: c.muted,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
  },
  card: {
    padding: spacing.xl,
    gap: spacing.lg,
    borderRadius: radius.xl,
  },
  fields: { gap: spacing.md },
  pillGroup: { gap: spacing.xs },
  optionalBadge: {
    alignSelf: "flex-start",
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  optionalText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold as any,
    color: c.teal,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  footer: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
}));
