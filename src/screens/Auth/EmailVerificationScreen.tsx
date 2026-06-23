import React, { useEffect, useState } from "react";
import { Animated, View, StyleSheet, AppState, ScrollView } from "react-native";

import { useSession } from "../../context/SessionContext";
import * as apiAuth from "../../lib/api/auth";
import { captureException } from "../../lib/sentry";

import { AuthLogo } from "../../components/ui/Account/AuthLogo";
import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useAuthEntrance, useAuthStyles } from "./authShared";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * "Onboarding zero": after sign-up the user lands here (logged in but with an
 * unverified email) and cannot proceed to onboarding until they verify. They can
 * resend the email or switch accounts. The screen polls /me so it advances by
 * itself once the link is tapped (in the browser / mail app).
 */
export function EmailVerificationScreen() {
  const styles = { ...useAuthStyles(), ...useStyles() };
  const { user, signOut, refreshUser } = useSession();
  const { headerOpacity, headerSlide, formOpacity, formSlide, footerOpacity } = useAuthEntrance();

  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Auto-detect verification: poll every 5s and whenever the app returns to the
  // foreground (after the user taps the link in their mail app). When
  // is_email_verified flips true, the root navigator advances past this gate.
  useEffect(() => {
    const tick = () => { refreshUser().catch(() => {}); };
    const interval = setInterval(tick, 5000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") tick(); });
    return () => { clearInterval(interval); sub.remove(); };
  }, [refreshUser]);

  // Resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onResend = async () => {
    setErr(null); setMsg(null);
    try {
      setBusy(true);
      await apiAuth.resendVerificationEmail();
      setMsg("Verification email sent. Check your inbox (and spam).");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Couldn't send the email. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onCheck = async () => {
    setErr(null); setMsg(null);
    try {
      setChecking(true);
      const u = await refreshUser();
      if (!u.is_email_verified) {
        setMsg("Not verified yet — tap the link in your email, then check again.");
      }
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Couldn't check your status. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  const onSignOut = () => { signOut().catch(() => {}); };

  return (
    <Screen edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.inner}>

          <Animated.View style={[styles.brand, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}>
            <AuthLogo size={72} />
            <AppText style={styles.appName}>Verify your email</AppText>
            <AppText style={styles.tagline}>
              {user?.email
                ? `We sent a verification link to ${user.email}. Tap it to continue — this screen updates automatically once you're verified.`
                : "We sent you a verification link. Tap it to continue — this screen updates automatically once you're verified."}
            </AppText>
          </Animated.View>

          <Animated.View style={{ opacity: formOpacity, transform: [{ translateY: formSlide }] }}>
            <Card style={styles.formCard}>

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
                label={checking ? "Checking…" : "I've verified — continue"}
                onPress={onCheck}
                disabled={checking || busy}
                tone="teal"
              />

              <SecondaryButton
                label={cooldown > 0 ? `Resend email (${cooldown}s)` : busy ? "Sending…" : "Resend email"}
                onPress={onResend}
                disabled={busy || checking || cooldown > 0}
              />

              <SecondaryButton
                label="Sign out / use a different email"
                onPress={onSignOut}
                disabled={busy || checking}
              />
            </Card>
          </Animated.View>

          <Animated.View style={{ opacity: footerOpacity }}>
            <AppText style={styles.footer}>
              You must verify your email before continuing. Didn't get it? Check spam, or resend.
            </AppText>
          </Animated.View>

        </View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  // Longer instructional copy needs extra line-height + padding (mirrors the
  // ForgotPassword tagline override).
  tagline: {
    fontSize: typescale.size.base,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.sm,
  },
}));
