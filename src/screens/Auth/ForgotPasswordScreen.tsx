import React, { useState } from "react";
import {
  Animated,
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
import { api } from "../../lib/api/client";
import { captureException } from "../../lib/sentry";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useAuthEntrance, useAuthStyles } from "./authShared";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const styles = { ...useAuthStyles(), ...useStyles() };
  const [email, setEmail] = useState("");
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState<string | null>(null);
  const [err, setErr]     = useState<string | null>(null);

  const { headerOpacity, headerSlide, formOpacity, formSlide, footerOpacity } = useAuthEntrance();

  const sendReset = async () => {
    setErr(null);
    setMsg(null);

    if (!email.trim()) {
      setErr("Enter your email first.");
      return;
    }

    try {
      setBusy(true);
      await api.post("/api/auth/password/forgot", { email: email.trim() });
      setMsg("If that email exists, you will receive a reset link shortly.");
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Failed to send reset link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["left", "right", "bottom"]}>
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

            {/* ── Brand ─────────────────────────────────────── */}
            <Animated.View style={[styles.brand, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}>
              <AuthLogo size={72} />
              <AppText style={styles.appName}>Reset password</AppText>
              <AppText style={styles.tagline}>
                {"Enter your email and we'll send you a link to reset your password."}
              </AppText>
            </Animated.View>

            {/* ── Form card ─────────────────────────────────── */}
            <Animated.View style={{ opacity: formOpacity, transform: [{ translateY: formSlide }] }}>
              <Card style={styles.formCard}>

                <EmailInput value={email} onChangeText={setEmail} label="Email" />

                {err ? (
                  <View style={styles.errorBanner}>
                    <AppText style={styles.errorText}>{err}</AppText>
                  </View>
                ) : null}

                {msg ? (
                  <View style={styles.successBanner}>
                    <AppText style={styles.successText}>{msg}</AppText>
                  </View>
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
            </Animated.View>

            {/* ── Footer ────────────────────────────────────── */}
            <Animated.View style={{ opacity: footerOpacity }}>
              <AppText style={styles.footer}>
                Your data stays private. Links you generate expire automatically.
              </AppText>
            </Animated.View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  // Overrides the shared tagline with extra line-height + padding for the
  // longer reset-password instructional copy.
  tagline: {
    fontSize: typescale.size.base,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.sm,
  },
}));
