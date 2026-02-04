import React from "react";
import { View, TextInput, StyleSheet, TextInputProps, Pressable } from "react-native";
import { AppText } from "./AppText";
import { colors, radius } from "../../../theme/tokens";

type Props = TextInputProps & {
  label?: string;
  rightAccessory?: React.ReactNode;
};

export function TextField({ label, style, rightAccessory, ...props }: Props) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={styles.wrap}>
        <TextInput
          {...props}
          placeholderTextColor={colors.subtle}
          style={[styles.input, style]}
        />
        {rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
      </View>
    </View>
  );
}

export function SmallTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.7 }]}>
      <AppText variant="caption" style={{ color: colors.teal, fontWeight: "800" }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    height: 46,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  right: { marginLeft: 10 },
  smallBtn: { paddingHorizontal: 6, paddingVertical: 4 },
});
