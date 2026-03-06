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
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { colors, spacing, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState<string | null>(null);
  const [err, setErr]     = useState<string | null>(null);

  const sendReset = async () => {
    setErr(null);
    setMsg(null);

    if (!email.trim()) {
      setErr("Enter your email first.");
      return;
    }

    try {
      setBusy(true);

      const redirectTo = process.env.EXPO_PUBLIC_RESET_REDIRECT_TO ?? "http://localhost:8081";
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw error;

      setMsg("If that email exists, you will receive a reset link shortly.");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send reset link.");
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
              <AppText variant="h1">Reset password</AppText>
              <AppText variant="muted" style={{ textAlign: "center" }}>
                Enter your email and we'll send you a link to reset your password.
              </AppText>
            </View>

            <Card style={styles.formCard}>
              <EmailInput value={email} onChangeText={setEmail} label="Email" />

              {err ? (
                <AppText variant="caption" style={{ color: colors.danger }}>{err}</AppText>
              ) : null}

              {msg ? (
                <AppText variant="caption" style={{ color: colors.success, fontWeight: typescale.weight.semibold }}>
                  {msg}
                </AppText>
              ) : null}

              <PrimaryButton
                label={busy ? "Sending…" : "Send reset link"}
                onPress={sendReset}
                disabled={busy}
                tone="teal"
              />

              <SecondaryButton
                label="Back to sign in"
                onPress={() => navigation.navigate("Login")}
                disabled={busy}
              />
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
  footer: {
    textAlign: "center",
    color: colors.subtle,
    paddingHorizontal: spacing.xl,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
});
