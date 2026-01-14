import React, { useState } from "react";
import { View, Text, TextInput, Button } from "react-native";
import { supabase } from "../lib/supabase";

export function LoginScreen() {
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
      <Text>Email</Text>
      <TextInput
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, padding: 8 }}
      />

      <Text>Password</Text>
      <TextInput
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, padding: 8 }}
      />

      {error && <Text style={{ color: "red" }}>{error}</Text>}

      <Button title="Sign in" onPress={signIn} />
    </View>
  );
}
