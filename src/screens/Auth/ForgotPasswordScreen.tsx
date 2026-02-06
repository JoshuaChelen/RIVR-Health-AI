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

import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { colors } from "../../theme/tokens";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sendReset = async () => {
    setErr(null);
    setMsg(null);

    if (!email.trim()) {
      setErr("Enter your email first.");
      return;
    }

    try {
      setBusy(true);

      const redirectTo =
        process.env.EXPO_PUBLIC_RESET_REDIRECT_TO ?? "http://localhost:8081";

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

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
      <View style={{ flex: 1 }}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={Keyboard.dismiss}
        />

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
                <View style={styles.logoDot}>
                  <View style={styles.logoInner} />
                </View>

                <AppText variant="h1">Reset password</AppText>
                <AppText variant="muted" style={{ textAlign: "center" }}>
                  Enter your email and we’ll send you a link to reset your password.
                </AppText>
              </View>

              {/* Form Card */}
              <Card style={styles.card}>
                <EmailInput value={email} onChangeText={setEmail} label="Email" />

                {err ? (
                  <AppText variant="caption" style={{ color: colors.danger }}>
                    {err}
                  </AppText>
                ) : null}

                {msg ? (
                  <AppText
                    variant="caption"
                    style={{ color: colors.green, fontWeight: "800" }}
                  >
                    {msg}
                  </AppText>
                ) : null}

                <PrimaryButton
                  label={busy ? "Sending..." : "Send reset link"}
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
    justifyContent: "center",
  },
  inner: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    gap: 32,
  },
  top: { alignItems: "center", gap: 12 },
  logoDot: {
    width: 56,
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
    backgroundColor: colors.teal,
  },
  card: {
    padding: 24,
    gap: 20,
  },
  footer: {
    textAlign: "center",
    opacity: 0.5,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
});
