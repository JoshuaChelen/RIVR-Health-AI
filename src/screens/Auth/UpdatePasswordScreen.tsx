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

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { PasswordInput } from "../../components/ui/Account/PasswordInput";
import { colors } from "../../theme/tokens";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";

type Props = NativeStackScreenProps<AuthStackParamList, "UpdatePassword">;

export function UpdatePasswordScreen({ navigation }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

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

      await supabase.auth.signOut();
      navigation.navigate("Login");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update password.");
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
                <AuthLogo />

                <AppText variant="h1">Set new password</AppText>
                <AppText variant="muted" style={{ textAlign: "center" }}>
                  Choose a new password for your account.
                </AppText>
              </View>

              {/* Form Card */}
              <Card style={styles.card}>
                {!ready ? (
                  <AppText variant="caption" style={{ color: colors.danger }}>
                    Open this screen from the reset link in your email.
                  </AppText>
                ) : null}

                <PasswordInput
                  value={password}
                  onChangeText={setPassword}
                  label="New Password"
                />
                <PasswordInput
                  value={confirm}
                  onChangeText={setConfirm}
                  label="Confirm New Password"
                />

                {err ? (
                  <AppText variant="caption" style={{ color: colors.danger }}>
                    {err}
                  </AppText>
                ) : null}

                {success ? (
                  <AppText
                    variant="caption"
                    style={{ color: colors.green, fontWeight: "800" }}
                  >
                    {success}
                  </AppText>
                ) : null}

                <PrimaryButton
                  label={busy ? "Updating..." : "Update password"}
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
