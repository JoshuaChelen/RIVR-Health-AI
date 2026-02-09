import React, { useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/authTypes";
import { supabase } from "../../lib/supabase";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";
import { colors } from "../../theme/tokens";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const onLogin = async () => {
    setErrorText(null);
    if (!email.trim() || !password) {
      setErrorText("Please enter your email and password.");
      return;
    }

    try {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
    } catch (e: any) {
      setErrorText(e?.message ?? "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={Keyboard.dismiss} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.inner}>
              {/* Top Brand */}
              <View style={styles.top}>
                <AuthLogo />
                <AppText variant="h1">Welcome back</AppText>
                <AppText variant="muted" style={{ textAlign: "center" }}>
                  Sign in to access your documents, sharing, and timeline.
                </AppText>
              </View>

              {/* Form Card */}
              <Card style={styles.card}>
                <EmailInput value={email} onChangeText={setEmail} label="Email" />
                <PasswordInput value={password} onChangeText={setPassword} label="Password" />

                {errorText && (
                  <AppText variant="caption" style={{ color: colors.danger }}>
                    {errorText}
                  </AppText>
                )}

                <PrimaryButton
                  label={busy ? "Signing in..." : "Sign in"}
                  onPress={onLogin}
                  disabled={busy}
                  tone="teal"
                />

                {busy && (
                  <View style={{ alignItems: "center", paddingTop: 6 }}>
                    <ActivityIndicator color={colors.teal} />
                  </View>
                )}

                <View style={styles.rowBetween}>
                  <Pressable onPress={() => navigation.navigate("ForgotPassword")}>
                    <AppText variant="caption" style={styles.link}>Forgot password?</AppText>
                  </Pressable>

                  <Pressable onPress={() => navigation.navigate("SignUp")}>
                    <AppText variant="caption" style={styles.link}>Create account</AppText>
                  </Pressable>
                </View>
              </Card>

              {/* Footer */}
              <AppText variant="caption" style={styles.footer}>
                Your data stays private. Links you generate expire automatically.
              </AppText>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { 
    flexGrow: 1, 
    paddingHorizontal: 20, 
    paddingVertical: 40,
    // This centers the stack vertically in the available space
    justifyContent: "center", 
  },
  inner: { 
    width: "100%", 
    maxWidth: 400, 
    alignSelf: "center",
    // Increased gap to breathe better on larger screens
    gap: 32, 
  },
  top: { 
    alignItems: "center", 
    gap: 12, 
  },
  logoDot: {
    width: 56, // Slightly larger logo for better presence
    height: 56, 
    borderRadius: 20, 
    backgroundColor: "#FFF",
    borderWidth: 1, 
    borderColor: colors.teal, 
    alignItems: "center", 
    justifyContent: "center",
    shadowColor: "#000", 
    shadowOpacity: 0.1, 
    shadowRadius: 8, 
    elevation: 3,
  },
  logoInner: { 
    width: 16, 
    height: 16, 
    borderRadius: 8, 
    backgroundColor: colors.teal 
  },
  card: { 
    padding: 24, // More internal padding for a "fuller" card
    gap: 20, 
  },
  row: { 
    flexDirection: "row", 
    justifyContent: "center", 
    gap: 6, 
    paddingTop: 8 
  },
  rowBetween: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    paddingTop: 8 
  },
  link: { 
    color: colors.teal, 
    fontWeight: "800" 
  },
  footer: { 
    textAlign: "center", 
    opacity: 0.5,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
});