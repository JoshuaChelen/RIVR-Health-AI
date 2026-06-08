// src/components/ui/Account/CreateAccount.tsx

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useSession } from "../../../context/SessionContext";

import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { SecondaryButton } from "../Primitives/SecondaryButton";
import { EmailInput } from "./EmailInput";
import { PasswordInput } from "./PasswordInput";
import { useTheme } from "../../../context/ThemeContext";

type Props = {
  onSuccess?: () => void;      // optional: called after sign up request succeeds
  onGoToLogin?: () => void;    // optional: for "Back to sign in"
};

export default function CreateAccount({ onSuccess, onGoToLogin }: Props) {
  const { colors } = useTheme();
  const { signUp } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const onCreate = async () => {
    setErrorText(null);
    setSuccessText(null);

    const e = email.trim();

    if (!e || !password || !confirm) {
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

      await signUp(e, password);

      // If email confirmations are enabled, session may be null
      setSuccessText(
        "Account created. Check your inbox to verify your email."
      );

      onSuccess?.();
    } catch (err: any) {
      setErrorText(err?.message ?? "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <AppText variant="title">Create account</AppText>
      <AppText variant="caption" style={{ marginTop: -6 }}>
        Join to start organizing your medical records safely.
      </AppText>

      <View style={{ height: 8 }} />

      <EmailInput value={email} onChangeText={setEmail} label="Email" />
      <PasswordInput value={password} onChangeText={setPassword} label="Password" />
      <PasswordInput value={confirm} onChangeText={setConfirm} label="Confirm Password" />

      {errorText ? (
        <AppText variant="caption" style={{ color: colors.danger }}>
          {errorText}
        </AppText>
      ) : null}

      {successText ? (
        <AppText variant="caption" style={{ color: colors.green, fontWeight: "700" }}>
          {successText}
        </AppText>
      ) : null}

      <PrimaryButton
        label={busy ? "Creating..." : "Create account"}
        onPress={onCreate}
        disabled={busy}
        tone="teal"
      />

      {onGoToLogin ? (
        <SecondaryButton label="Back to sign in" onPress={onGoToLogin} disabled={busy} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 24,
    gap: 16,
  },
});