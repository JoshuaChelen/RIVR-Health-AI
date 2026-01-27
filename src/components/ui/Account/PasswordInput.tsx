import React, { useState } from "react";
import { View, Text, TextInput, Button, TextInputProps } from "react-native";

interface PasswordInputProps extends TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
}

export function PasswordInput({
  value,
  onChangeText,
  label = "Enter Password",
  ...props
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={{ gap: 4 }}>
      <Text>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          secureTextEntry={!showPassword}
          value={value}
          onChangeText={onChangeText}
          style={{ borderWidth: 1, padding: 8, flex: 1 }}
          {...props}
        />
        <Button
          title={showPassword ? "Hide" : "Show"}
          onPress={() => setShowPassword(prev => !prev)}
        />
      </View>
    </View>
  );
}
