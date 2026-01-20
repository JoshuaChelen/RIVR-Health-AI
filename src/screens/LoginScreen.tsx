import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";

export function LoginScreen() {
  const [email, setEmail] = useState("guest@email.com");
  const [password, setPassword] = useState("123");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const signIn = async () => {
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) setError(error.message);
  };

  const signUp = async () => {
    setError(null);
    setInfo(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      return;
    }

    // Inform the user about verification or next steps.
    setInfo(
      "Account created. Check your email for a confirmation link, then sign in."
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Email</Text>
      <TextInput
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        placeholder="you@example.com"
        keyboardType="email-address"
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
        placeholder="••••••••"
      />

      {error && <Text style={styles.error}>{error}</Text>}
      {info && <Text style={styles.info}>{info}</Text>}

      <View style={styles.buttonRow}>
        <View style={styles.buttonWrapper}>
          <Button
            title={creating ? "Create account" : "Sign in"}
            onPress={creating ? signUp : signIn}
          />
        </View>

        <View style={styles.toggleButton}>
          <Button
            title={creating ? "Have an account? Sign in" : "Create an account"}
            onPress={() => {
              setError(null);
              setInfo(null);
              setCreating(!creating);
            }}
            color="#444"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#f6f7fb",
  },
  label: {
    fontSize: 14,
    marginBottom: 6,
    color: "#222",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d0d6df",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  error: {
    color: "#b00020",
    marginBottom: 8,
  },
  info: {
    color: "#1b7a3a",
    marginBottom: 8,
  },
  buttonRow: {
    marginTop: 8,
  },
  buttonWrapper: {
    marginBottom: 8,
  },
  toggleButton: {
    marginTop: 4,
  },
});
