import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OnboardingStackParamList } from "../../navigation/onboardingTypes";

import { getProfile, upsertProfile } from "../../lib/profile";
import { getCurrentUser } from "../../lib/auth";
import { captureException } from "../../lib/sentry";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { TextField } from "../../components/ui/Primitives/TextField";
import { PhoneField, parseStoredPhone, COUNTRIES, type Country } from "../../components/ui/Primitives/PhoneField";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { GhostButton } from "../../components/ui/Primitives/GhostButton";
import { Card } from "../../components/ui/Primitives/Card";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { OnboardingProgressBar } from "../../components/ui/Onboarding/OnboardingProgressBar";
import { OptionPills } from "../../components/ui/Onboarding/OptionPills";

import { radius, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";

type Props = NativeStackScreenProps<OnboardingStackParamList, "OnboardingStep2">;

const MARITAL_OPTIONS = ["Single", "Married", "Partnered", "Divorced", "Widowed"];

export function OnboardingStep2Screen({ navigation }: Props) {
  const styles = useStyles();
  const [email, setEmail]         = useState("");
  const [phoneCountry, setPhoneCountry] = useState<Country>(COUNTRIES[0]);
  const [phoneNumber, setPhoneNumber]   = useState("");
  const [occupation, setOccupation] = useState("");
  const [marital, setMarital]     = useState<string | null>(null);
  const [children, setChildren]   = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ── Load existing data ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) return;
        const profile = await getProfile(user.id);
        setEmail(profile?.email ?? user.email ?? "");
        if (profile?.mobile_phone) {
          const { country, number } = parseStoredPhone(profile.mobile_phone);
          setPhoneCountry(country);
          setPhoneNumber(number);
        }
        setOccupation(profile?.occupation ?? "");
        setMarital(profile?.marital_status ?? null);
        setChildren(
          profile?.number_of_children != null
            ? String(profile.number_of_children)
            : ""
        );
      } catch (e) {
        captureException(e);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, []);

  // No fields are required — user can skip freely
  const canContinue = !loadingProfile;

  async function handleNext() {
    setError(null);
    const childrenNum = children.trim() ? parseInt(children.trim(), 10) : null;
    if (children.trim() && (isNaN(childrenNum!) || childrenNum! < 0)) {
      setError("Number of children must be a non-negative number.");
      return;
    }
    const fullPhone = phoneNumber.trim()
      ? `${phoneCountry.dial} ${phoneNumber.trim()}`
      : null;
    try {
      setSaving(true);
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated.");
      await upsertProfile(user.id, {
        email:              email.trim() || null,
        mobile_phone:       fullPhone,
        occupation:         occupation.trim() || null,
        marital_status:     marital ?? null,
        number_of_children: childrenNum,
      });
      navigation.navigate("OnboardingStep3");
    } catch (e: any) {
      captureException(e);
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.inner}>
            <OnboardingProgressBar current={2} total={3} />

            <View style={styles.header}>
              <AppText style={styles.title}>Stay connected</AppText>
              <AppText style={styles.subtitle}>
                Your contact details and a bit about your life.
              </AppText>
            </View>

            <Card style={styles.card}>
              <View style={styles.optionalBadge}>
                <AppText style={styles.optionalText}>All fields are optional</AppText>
              </View>

              <View style={styles.fields}>
                <TextField
                  label="Email"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  disabled
                />

                <PhoneField
                  label="Mobile phone"
                  country={phoneCountry}
                  number={phoneNumber}
                  onCountryChange={setPhoneCountry}
                  onNumberChange={setPhoneNumber}
                  editable={!saving}
                  returnKeyType="next"
                />

                <TextField
                  label="Occupation"
                  placeholder="e.g. Software engineer, Nurse, Teacher"
                  value={occupation}
                  onChangeText={setOccupation}
                  autoCapitalize="words"
                  returnKeyType="next"
                  editable={!saving}
                  maxLength={200}
                />

                <View style={styles.pillGroup}>
                  <AppText variant="label">Marital status</AppText>
                  <OptionPills
                    options={MARITAL_OPTIONS}
                    selected={marital}
                    onSelect={setMarital}
                  />
                </View>

                <View>
                  <TextField
                    label="Number of children"
                    placeholder="Optional"
                    value={children}
                    onChangeText={setChildren}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    editable={!saving}
                  />
                </View>
              </View>

              <ErrorBanner message={error} />

              <View style={styles.actions}>
                <SecondaryButton
                  label="Back"
                  onPress={() => navigation.goBack()}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label={saving ? "Saving…" : "Continue"}
                  onPress={handleNext}
                  disabled={!canContinue || saving}
                  tone="teal"
                  style={{ flex: 2 }}
                />
              </View>

                <GhostButton
                label="Skip — I'll add this later"
                onPress={handleNext}
                disabled={saving}
              />
            </Card>
            <AppText style={styles.footer}>
                          Your information is encrypted and only visible to you.
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
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  inner: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    gap: spacing.xl,
  },
  header: { gap: 6 },
  title: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.bold as any,
    color: c.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typescale.size.base,
    color: c.muted,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
  },
  card: {
    padding: spacing.xl,
    gap: spacing.lg,
    borderRadius: radius.xl,
  },
  optionalBadge: {
    alignSelf: "flex-start",
    backgroundColor: c.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  optionalText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold as any,
    color: c.teal,
  },
  fields:    { gap: spacing.md },
  pillGroup: { gap: spacing.xs },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  footer: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.lg,
  },
}));
