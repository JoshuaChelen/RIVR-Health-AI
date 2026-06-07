import React, { useEffect, useState } from "react";
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
import { captureException } from "../../lib/sentry";
import { clearEmergencyCardWidget } from "../../lib/emergencyCardWidget";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";
import { spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";

type Props = NativeStackScreenProps<AuthStackParamList, "UpdatePassword">;

export function UpdatePasswordScreen({ navigation }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [ready, setReady]       = useState(false);
  const [success, setSuccess]   = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setReady(!!data.session);
    })();
  }, []);

  const update = async () => {
    setErr(null);
    setSuccess(null);

    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    try {
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setSuccess("Password updated. Please sign in again.");
      clearEmergencyCardWidget();
      await supabase.auth.signOut();
      navigation.navigate("Login");
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Failed to update password.");
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
            <View style={styles.brand}>
              <AuthLogo size={68} />
              <AppText variant="h1">Set new password</AppText>
              <AppText variant="muted" style={{ textAlign: "center" }}>
                Choose a new password for your account.
              </AppText>
            </View>

            <Card style={styles.formCard}>
              {!ready ? (
                <AppText variant="caption" style={{ color: colors.danger }}>
                  Open this screen from the reset link in your email.
                </AppText>
              ) : null}

              <PasswordInput value={password} onChangeText={setPassword} label="New Password" />
              <PasswordInput value={confirm}  onChangeText={setConfirm}  label="Confirm New Password" />

              {err ? (
                <AppText variant="caption" style={{ color: colors.danger }}>{err}</AppText>
              ) : null}

              {success ? (
                <AppText variant="caption" style={{ color: colors.success }}>{success}</AppText>
              ) : null}

              <PrimaryButton
                label={busy ? "Updating…" : "Update password"}
                onPress={update}
                disabled={busy || !ready}
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
  },
  formCard: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  footer: {
    textAlign: "center",
    color: c.subtle,
    paddingHorizontal: spacing.xl,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
}));
