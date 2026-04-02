import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
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
import { captureException } from "../../lib/sentry";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const styles = useStyles();
  const [email, setEmail] = useState("");
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState<string | null>(null);
  const [err, setErr]     = useState<string | null>(null);

  // Entrance animation
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide   = useRef(new Animated.Value(16)).current;
  const formOpacity   = useRef(new Animated.Value(0)).current;
  const formSlide     = useRef(new Animated.Value(24)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(headerSlide,   { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(formOpacity, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(formSlide,   { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(footerOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

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
                Enter your email and we'll send you a link to reset your password.
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
    paddingBottom: spacing.xs,
  },
  appName: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.bold,
    color: c.text,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: typescale.size.base,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.sm,
  },

  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: 20,
  },

  errorBanner: {
    backgroundColor: c.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.dangerBorder,
  },
  errorText: {
    fontSize: typescale.size.sm,
    color: c.danger,
    fontWeight: typescale.weight.medium,
  },

  successBanner: {
    backgroundColor: c.successSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.successBorder,
  },
  successText: {
    fontSize: typescale.size.sm,
    color: c.success,
    fontWeight: typescale.weight.medium,
  },

  footer: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
}));
