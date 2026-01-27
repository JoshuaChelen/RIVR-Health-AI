import React, { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { View, Text, Button } from "react-native";
import { supabase } from "../../lib/supabase";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { AuthStackParamList } from "../../navigation/authTypes";


type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("guest@email.com");
  const [password, setPassword] = useState("123");
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) setError(error.message);
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <EmailInput
        value={email}
        onChangeText={setEmail}
        placeholder="Enter Email"
      />

      <PasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="Enter password"
      />

      {error && <Text style={{ color: "red" }}>{error}</Text>}

      <Button title="Sign in" onPress={signIn} />

      <Text>Don't have an account? Sign Up</Text>
      <Button title="Sign Up" onPress={() => navigation.navigate("SignUp")} />
    </View>
  );
}
