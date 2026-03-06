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
import { colors, spacing, radius, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Entrance animation
  const headerOpacity  = useRef(new Animated.Value(0)).current;
  const headerSlide    = useRef(new Animated.Value(16)).current;
  const formOpacity    = useRef(new Animated.Value(0)).current;
  const formSlide      = useRef(new Animated.Value(24)).current;
  const footerOpacity  = useRef(new Animated.Value(0)).current;

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
      Animated.timing(footerOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, []);

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
                    <ActivityIndicator color={colors.teal} size="small" />
                  </View>
                ) : null}

                <View style={styles.divider} />

                <View style={styles.links}>
                  <Pressable
                    onPress={() => navigation.navigate("ForgotPassword")}
                    style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.6 }]}
                  >
                    <AppText style={styles.linkText}>Forgot password?</AppText>
                  </Pressable>
                  <Pressable
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
    paddingBottom: spacing.xs,
  },
  appName: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: typescale.size.base,
    color: colors.muted,
    textAlign: "center",
  },

  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: 20,
  },
  formHeader: {
    gap: 4,
    marginBottom: spacing.xs,
  },
  formTitle: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  formSub: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  fields: {
    gap: spacing.md,
  },

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium,
  },

  busyRow: {
    alignItems: "center",
    paddingTop: 2,
  },

  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.xxs,
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
    color: colors.muted,
    fontWeight: typescale.weight.medium,
  },
  linkBtnPrimary: {
    backgroundColor: colors.tealSoft,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  linkTextPrimary: {
    fontSize: typescale.size.sm,
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
  },

  footer: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: colors.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
});
