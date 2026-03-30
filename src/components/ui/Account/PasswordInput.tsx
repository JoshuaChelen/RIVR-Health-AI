import React, { useState } from "react";
import { TextInputProps } from "react-native";
import { TextField, SmallTextButton } from "../Primitives/TextField";

interface PasswordInputProps extends TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
}

export function PasswordInput({
  value,
  onChangeText,
  label = "Password",
  ...props
}: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={!show}
      textContentType="password"
      placeholder="Enter password"
      autoCapitalize="none"
      rightAccessory={
        <SmallTextButton label={show ? "Hide" : "Show"} onPress={() => setShow((p) => !p)} />
      }
      {...props}
    />
  );
}
