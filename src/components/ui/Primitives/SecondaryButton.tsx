import React from "react";
import { StyleSheet, ViewStyle, StyleProp } from "react-native";
import { ButtonBase } from "./ButtonBase";
import { radius, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SecondaryButton({ label, onPress, disabled, style }: Props) {
  const styles = useStyles();
  return (
    <ButtonBase
      label={label}
      onPress={onPress}
      disabled={disabled}
      style={style}
      btnStyle={styles.btn}
      textStyle={styles.text}
      disabledStyle={styles.disabled}
      pressedStyle={styles.pressed}
    />
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  text: {
    color: c.text,
    fontWeight: typescale.weight.semibold,
    fontSize: typescale.size.base,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.75,
    backgroundColor: c.bgSecondary,
  },
}));
