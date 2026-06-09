import React from "react";
import { StyleSheet, ViewStyle, StyleProp } from "react-native";
import { ButtonBase } from "./ButtonBase";
import { typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function GhostButton({ label, onPress, disabled, style }: Props) {
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
      textVariant="caption"
    />
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  btn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  text: {
    color: c.teal,
    fontWeight: typescale.weight.semibold,
    fontSize: typescale.size.base,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.65,
  },
}));
