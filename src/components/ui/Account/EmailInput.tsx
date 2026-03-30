import React from "react";
import { TextInputProps } from "react-native";
import { TextField } from "../Primitives/TextField";

interface EmailInputProps extends TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
}

export function EmailInput({ value, onChangeText, label = "Email", ...props }: EmailInputProps) {
  return (
    <TextField
      label={label}
      autoCapitalize="none"
      keyboardType="email-address"
      textContentType="emailAddress"
      autoComplete="email"
      value={value}
      onChangeText={onChangeText}
      placeholder="email@address.com"
      {...props}
    />
  );
}
