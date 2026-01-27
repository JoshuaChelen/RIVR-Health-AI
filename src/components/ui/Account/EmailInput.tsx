import React from "react";
import { View, Text, TextInput, TextInputProps } from "react-native";

interface EmailInputProps extends TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
}

export function EmailInput({
  value,
  onChangeText,
  label = "Email",
  ...props
}: EmailInputProps) {
  return (
    <View style={{ gap: 4 }}>
      <Text>{label}</Text>
      <TextInput
        autoCapitalize="none"
        value={value}
        onChangeText={onChangeText}
        style={{ borderWidth: 1, padding: 8 }}
        {...props}
      />
    </View>
  );
}
