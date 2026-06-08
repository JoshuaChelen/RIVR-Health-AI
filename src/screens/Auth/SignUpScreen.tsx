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
import { useSession } from "../../context/SessionContext";
import { captureException } from "../../lib/sentry";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { EmailInput } from "../../components/ui/Account/EmailInput";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";
import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";

type Props = NativeStackScreenProps<AuthStackParamList, "SignUp">;

export function SignUpScreen({ navigation }: Props) {
  const styles = useStyles();
  const { signUp } = useSession();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [errorText, setErrorText]     = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

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
      Animated.timing(footerOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
    // Run the entrance animation only once when the screen mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const result = await signUp(email.trim(), password);
      setSuccessText(result ? "Account created!" : "Check your inbox to verify your email.");
    } catch (e: any) {
      captureException(e);
      setErrorText(e?.message ?? "Sign up failed.");
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
              <AppText style={styles.appName}>Create account</AppText>
              <AppText style={styles.tagline}>Start organizing your health records safely.</AppText>
            </Animated.View>

            {/* ── Form card ─────────────────────────────────── */}
            <Animated.View style={{ opacity: formOpacity, transform: [{ translateY: formSlide }] }}>
              <Card style={styles.formCard}>

                <View style={styles.fields}>
                  <EmailInput    value={email}    onChangeText={setEmail}    label="Email" />
                  <PasswordInput value={password} onChangeText={setPassword} label="Password" />
                  <PasswordInput value={confirm}  onChangeText={setConfirm}  label="Confirm password" />
                </View>

                {errorText ? (
                  <View style={styles.errorBanner}>
                    <AppText style={styles.errorText}>{errorText}</AppText>
                  </View>
                ) : null}

                {successText ? (
                  <View style={styles.successBanner}>
                    <AppText style={styles.successText}>{successText}</AppText>
                  </View>
                ) : null}

                <PrimaryButton
                  label={busy ? "Creating…" : "Create account"}
                  onPress={onSignUp}
                  disabled={busy}
                  tone="teal"
                />

                <View style={styles.divider} />

                <View style={styles.signInRow}>
                  <AppText style={styles.signInPrompt}>Already have an account?</AppText>
                  <Pressable
                    onPress={() => navigation.navigate("Login")}
                    style={({ pressed }) => [styles.signInBtn, pressed && { opacity: 0.6 }]}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="Sign in"
                    accessibilityHint="Navigate to sign in"
                  >
                    <AppText style={styles.signInBtnText}>Sign in</AppText>
                  </Pressable>
                </View>
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
  },

  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: 20,
  },

  fields: {
    gap: spacing.md,
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

  divider: {
    height: 1,
    backgroundColor: c.borderLight,
    marginVertical: spacing.xxs,
  },

  signInRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  signInPrompt: {
    fontSize: typescale.size.sm,
    color: c.muted,
  },
  signInBtn: {
    backgroundColor: c.tealSoft,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  signInBtnText: {
    fontSize: typescale.size.sm,
    color: c.teal,
    fontWeight: typescale.weight.semibold,
  },

  footer: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
}));
