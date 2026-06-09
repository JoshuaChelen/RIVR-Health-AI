import { StyleSheet } from "react-native";
import { radius, spacing, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

/**
 * Shared dashed-card shell + icon-circle row styles for the Documents action
 * cards (Upload/Scan in UploadFile, Voice Note in RecordVoiceNote). Each screen
 * merges its own variant styles on top:
 *   const styles = { ...useDocCardStyles(), ...useStyles() };
 */
export const useDocCardStyles = createStyles((c) => StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: c.tealBorder,
    borderRadius: radius.lg,
    backgroundColor: c.tealSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...shadows.xs,
  },
  divider: {
    height: 1,
    backgroundColor: c.tealBorder,
    opacity: 0.5,
    marginHorizontal: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: { opacity: 0.7 },
  rowDisabled: { opacity: 0.5 },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: c.teal,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  textBlock: { flex: 1, gap: 2 },
  rowTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.teal,
  },
  rowHint: {
    fontSize: typescale.size.xs,
    color: c.teal,
    opacity: 0.75,
  },
}));
