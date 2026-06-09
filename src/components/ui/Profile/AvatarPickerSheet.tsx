import React from "react";
import { View, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppText } from "../Primitives/AppText";
import { BottomSheet } from "../Primitives/BottomSheet";
import { spacing, radius, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type Props = {
  visible: boolean;
  hasPhoto: boolean;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
  onRemovePhoto: () => void;
  onClose: () => void;
};

export function AvatarPickerSheet({
  visible,
  hasPhoto,
  onTakePhoto,
  onChooseFromLibrary,
  onRemovePhoto,
  onClose,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accent="teal"
      title="Profile photo"
      message="Used on your 3x5 emergency card so a provider can match the card to you."
    >
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Take photo"
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        onPress={onTakePhoto}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="camera-outline" size={18} color={colors.teal} />
        </View>
        <AppText style={styles.rowText}>Take photo</AppText>
      </Pressable>

      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Choose from library"
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        onPress={onChooseFromLibrary}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="images-outline" size={18} color={colors.teal} />
        </View>
        <AppText style={styles.rowText}>Choose from library</AppText>
      </Pressable>

      {hasPhoto ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Remove photo"
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          onPress={onRemovePhoto}
        >
          <View style={[styles.iconWrap, styles.iconWrapDanger]}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </View>
          <AppText style={[styles.rowText, styles.rowTextDanger]}>Remove photo</AppText>
        </Pressable>
      ) : null}

      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
        onPress={onClose}
      >
        <AppText style={styles.cancelText}>Cancel</AppText>
      </Pressable>
    </BottomSheet>
  );
}

const useStyles = createStyles((c) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  } as const,
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  } as const,
  iconWrapDanger: {
    backgroundColor: c.dangerSoft,
  } as const,
  rowText: {
    fontSize: typescale.size.base,
    color: c.text,
    fontWeight: typescale.weight.medium,
  } as const,
  rowTextDanger: {
    color: c.danger,
  } as const,
  cancel: {
    marginTop: spacing.xs,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.bgSecondary,
    borderWidth: 1,
    borderColor: c.border,
  } as const,
  cancelText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
  } as const,
}));
