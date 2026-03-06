import React, { useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
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

type Props = NativeStackScreenProps<AuthStackParamList, "SignUp">;

export function SignUpScreen({ navigation }: Props) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [errorText, setErrorText]   = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const onSignUp = async () => {
    setErrorText(null);
    setSuccessText(null);

    if (!email.trim() || !password) {
      setErrorText("Please fill out all fields.");
      return;
    }
    if (password.length < 6) {
      setErrorText("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorText("Passwords do not match.");
      return;
    }

    try {
      setBusy(true);
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      setSuccessText(data.session ? "Account created!" : "Check your inbox to verify your email.");
    } catch (e: any) {
      setErrorText(e?.message ?? "Sign up failed.");
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
            <View style={styles.brand}>
              <AuthLogo size={68} />
              <AppText variant="h1">Create account</AppText>
              <AppText variant="muted" style={{ textAlign: "center" }}>
                Start organizing your health records safely.
              </AppText>
            </View>

            <Card style={styles.formCard}>
              <EmailInput    value={email}    onChangeText={setEmail}    label="Email" />
              <PasswordInput value={password} onChangeText={setPassword} label="Password" />
              <PasswordInput value={confirm}  onChangeText={setConfirm}  label="Confirm Password" />

              {errorText ? (
                <AppText variant="caption" style={{ color: colors.danger }}>{errorText}</AppText>
              ) : null}
              {successText ? (
                <AppText variant="caption" style={{ color: colors.success }}>{successText}</AppText>
              ) : null}

              <PrimaryButton
                label={busy ? "Creating…" : "Create account"}
                onPress={onSignUp}
                disabled={busy}
                tone="teal"
              />

              <View style={styles.signInRow}>
                <AppText variant="caption">Already have an account?</AppText>
                <Pressable onPress={() => navigation.navigate("Login")}>
                  <AppText variant="caption" style={styles.link}>Sign in</AppText>
                </Pressable>
              </View>
            </Card>

            <AppText variant="caption" style={styles.footer}>
              Your data stays private. Links you generate expire automatically.
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
  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  signInRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingTop: spacing.xs,
  },
  link: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
  },
  footer: {
    textAlign: "center",
    color: colors.subtle,
    paddingHorizontal: spacing.xl,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
});
