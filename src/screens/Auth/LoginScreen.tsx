import React, { useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
  ActivityIndicator,
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
import { colors, spacing, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
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
      <Pressable style={StyleSheet.absoluteFillObject} onPress={Keyboard.dismiss} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.inner}>
            {/* Brand */}
            <View style={styles.brand}>
              <AuthLogo size={68} />
              <AppText variant="h1" style={styles.appName}>RIVR Health</AppText>
              <AppText variant="muted" style={styles.tagline}>
                Your health records, organized.
              </AppText>
            </View>

            {/* Form */}
            <Card style={styles.formCard}>
              <AppText variant="h2" style={styles.formTitle}>Welcome back</AppText>
              <AppText variant="muted" style={styles.formSub}>
                Sign in to access your documents and timeline.
              </AppText>

              <EmailInput    value={email}    onChangeText={setEmail}    label="Email" />
              <PasswordInput value={password} onChangeText={setPassword} label="Password" />

              {errorText ? (
                <AppText variant="caption" style={{ color: colors.danger }}>
                  {errorText}
                </AppText>
              ) : null}

              <PrimaryButton
                label={busy ? "Signing in…" : "Sign in"}
                onPress={onLogin}
                disabled={busy}
                tone="teal"
              />

              {busy ? (
                <View style={{ alignItems: "center" }}>
                  <ActivityIndicator color={colors.teal} />
                </View>
              ) : null}

              <View style={styles.links}>
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
              Your data stays private. Links you share expire automatically.
            </AppText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    justifyContent: "center",
  },
  inner: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: spacing.xl,
  },

  brand: {
    alignItems: "center",
    gap: spacing.sm,
  },
  appName: {
    color: colors.text,
    letterSpacing: -0.3,
  },
  tagline: {
    textAlign: "center",
  },

  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  formTitle: {
    marginBottom: 2,
  },
  formSub: {
    marginBottom: spacing.xs,
  },

  links: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
  },
  link: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
  },

  footer: {
    textAlign: "center",
    color: colors.subtle,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.xl,
  },
});
