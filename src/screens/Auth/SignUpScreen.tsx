import React, { useState } from "react";
import { View, Button, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AuthStackParamList } from "../../navigation/authTypes";
import { supabase } from "../../lib/supabase";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";

type Props = NativeStackScreenProps<AuthStackParamList, "SignUp">;

const MIN_PASSWORD_LENGTH = 8;

export function SignUpScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password1, setPassword1] = useState("");
  const [password2, setPassword2] = useState("");

  const isDisabled =
    !email ||
    password1 !== password2 ||
    password1.length < MIN_PASSWORD_LENGTH;

  const signUp = async () => {
    if (isDisabled) return;

    const { data, error } = await supabase.auth.signUp({
      email,
      password: password1,
    });

    if (error) {
      Alert.alert(error.message);
      return;
    }

    if (!data.session) {
      Alert.alert("Please check your inbox for email verification!");
    }
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <EmailInput
        value={email}
        onChangeText={setEmail}
        placeholder="Enter Email"
      />

      <PasswordInput
        value={password1}
        onChangeText={setPassword1}
        placeholder="Enter password"
      />

      <PasswordInput
        value={password2}
        onChangeText={setPassword2}
        placeholder="Confirm password"
      />

      <Button
        title="Create Account"
        onPress={signUp}
        disabled={isDisabled}
      />

      <Button title="Sign In" onPress={() => navigation.navigate("Login")} />
    </View>
  );
}
