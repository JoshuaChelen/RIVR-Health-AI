import React, { useState } from "react";
import {
  Animated,
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
import { captureException } from "../../lib/sentry";
import { useSession } from "../../context/SessionContext";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";
import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import { useAuthEntrance, useAuthStyles } from "./authShared";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const styles = { ...useAuthStyles(), ...useStyles() };
  const { colors } = useTheme();
  const { signIn } = useSession();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const { headerOpacity, headerSlide, formOpacity, formSlide, footerOpacity } = useAuthEntrance();

  const onLogin = async () => {
    setErrorText(null);
    if (!email.trim() || !password) {
      setErrorText("Please enter your email and password.");
      return;
    }
    try {
      setBusy(true);
      await signIn(email.trim(), password);
    } catch (e: any) {
      captureException(e);
      setErrorText(e?.message ?? "Login failed.");
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
              <AppText style={styles.appName}>RIVR Health</AppText>
              <AppText style={styles.tagline}>Your health records, organized.</AppText>
            </Animated.View>

            {/* ── Form card ─────────────────────────────────── */}
            <Animated.View style={{ opacity: formOpacity, transform: [{ translateY: formSlide }] }}>
              <Card style={styles.formCard}>
                <View style={styles.formHeader}>
                  <AppText style={styles.formTitle}>Welcome back</AppText>
                  <AppText style={styles.formSub}>Sign in to access your documents and timeline.</AppText>
                </View>

                <View style={styles.fields}>
                  <EmailInput    value={email}    onChangeText={setEmail}    label="Email" />
                  <PasswordInput value={password} onChangeText={setPassword} label="Password" />
                </View>

                {errorText ? (
                  <View style={styles.errorBanner}>
                    <AppText style={styles.errorText}>{errorText}</AppText>
                  </View>
                ) : null}

                <PrimaryButton
                  label={busy ? "Signing in…" : "Sign in"}
                  onPress={onLogin}
                  disabled={busy}
                  tone="teal"
                />

                {busy ? (
                  <View style={styles.busyRow}>
                    <ActivityIndicator color={colors.teal} size="small" accessibilityLabel="Signing in" />
                  </View>
                ) : null}


                <View style={styles.divider} />

                <View style={styles.links}>
                  <Pressable
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password?"
                    accessibilityHint="Navigate to password reset"
                    onPress={() => navigation.navigate("ForgotPassword")}
                    style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.6 }]}
                  >
                    <AppText style={styles.linkText}>Forgot password?</AppText>
                  </Pressable>
                  <Pressable
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="Create account"
                    accessibilityHint="Navigate to sign up"
                    onPress={() => navigation.navigate("SignUp")}
                    style={({ pressed }) => [styles.linkBtnPrimary, pressed && { opacity: 0.6 }]}
                  >
                    <AppText style={styles.linkTextPrimary}>Create account</AppText>
                  </Pressable>
                </View>
              </Card>
            </Animated.View>

            {/* ── Footer ────────────────────────────────────── */}
            <Animated.View style={{ opacity: footerOpacity }}>
              <AppText style={styles.footer}>
                Your data stays private. Links you share expire automatically.
              </AppText>
            </Animated.View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  formHeader: {
    gap: 4,
    marginBottom: spacing.xs,
  },
  formTitle: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold,
    color: c.text,
    letterSpacing: -0.3,
  },
  formSub: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  busyRow: {
    alignItems: "center",
    paddingTop: 2,
  },
  links: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  linkBtn: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  linkText: {
    fontSize: typescale.size.sm,
    color: c.muted,
    fontWeight: typescale.weight.medium,
  },
  linkBtnPrimary: {
    backgroundColor: c.tealSoft,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  linkTextPrimary: {
    fontSize: typescale.size.sm,
    color: c.teal,
    fontWeight: typescale.weight.semibold,
  },
}));
