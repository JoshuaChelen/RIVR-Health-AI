import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { ErrorBanner } from "../Primitives/ErrorBanner";
import { radius, spacing, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

export type SectionCardProps = {
  icon: React.ReactNode;
  title: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  canSave?: boolean;
  children: React.ReactNode;
};

export function SectionCard({
  icon, title, editing, onEdit, onCancel, onSave,
  saving, error, canSave = true, children,
}: SectionCardProps) {
  const sc = useStyles();
  return (
    <Card style={sc.card}>
      <View style={sc.header}>
        <View style={sc.titleRow}>
         <View style={sc.iconWrap}>{icon}</View>
         <AppText style={sc.title}>{title}</AppText>
        </View>
        {editing ? (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Cancel editing ${title}`}
            onPress={onCancel}
            style={({ pressed }) => [sc.actionBtn, sc.cancelBtn, pressed && { opacity: 0.6 }]}
          >
            <AppText style={sc.cancelText}>Cancel</AppText>
          </Pressable>
        ) : (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Edit ${title}`}
            onPress={onEdit}
            style={({ pressed }) => [sc.actionBtn, pressed && { opacity: 0.6 }]}
          >
            <AppText style={sc.editText}>Edit</AppText>
          </Pressable>
        )}
      </View>

      <View style={sc.divider} />

      <View style={sc.content}>{children}</View>

      {editing && (
        <View style={sc.saveArea}>
          <ErrorBanner message={error} />
          <PrimaryButton
            label={saving ? "Saving…" : "Save changes"}
            onPress={onSave}
            disabled={saving || !canSave}
            tone="teal"
          />
        </View>
      )}
    </Card>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  card: {
    padding: 0,
    overflow: "hidden",
    borderRadius: radius.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconWrap: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold as any,
    color: c.text,
  },
  actionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: c.tealSoft,
  },
  cancelBtn: {
    backgroundColor: c.bgSecondary,
  },
  editText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.teal,
  },
  cancelText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.muted,
  },
  divider: {
    height: 1,
    backgroundColor: c.borderLight,
    marginHorizontal: spacing.lg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  saveArea: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
}));
