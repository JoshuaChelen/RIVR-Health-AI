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
import { getCurrentUserId } from "../../lib/auth";
import { captureException } from "../../lib/sentry";
import { useOnboarding } from "../../context/OnboardingContext";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { TextField } from "../../components/ui/Primitives/TextField";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
import { GhostButton } from "../../components/ui/Primitives/GhostButton";
import { Card } from "../../components/ui/Primitives/Card";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { OnboardingProgressBar } from "../../components/ui/Onboarding/OnboardingProgressBar";

import { spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useOnboardingStyles } from "./onboardingStyles";
import { COUNTRIES, Country, parseStoredPhone, PhoneField } from "../../components/ui/Primitives/PhoneField";

type Props = NativeStackScreenProps<OnboardingStackParamList, "OnboardingStep3">;

export function OnboardingStep3Screen({ navigation }: Props) {
  const styles = { ...useOnboardingStyles(), ...useStyles() };
  const { onComplete } = useOnboarding();

  const [contactName, setContactName]   = useState("");
  const [contactPhoneCountry, setContactPhoneCountry] = useState<Country>(COUNTRIES[0]);
  const [contactPhoneNumber, setContactPhoneNumber] = useState("");
  const [contactRel, setContactRel]     = useState("");
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // ── Load existing data (form renders immediately) ─────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const profile = await getProfile(userId);
        if (profile) {
          setContactName(profile.emergency_contact_name ?? "");
          const parsedEmergency = parseStoredPhone(profile.emergency_contact_phone ?? "");
          setContactPhoneCountry(parsedEmergency.country);
          setContactPhoneNumber(parsedEmergency.number);
          setContactRel(profile.emergency_contact_relationship ?? "");
        }
      } catch (e) {
        captureException(e);
      }
    })();
  }, []);

  // ── finish() always saves current form state (empty = null).
  // This avoids a bug where finish(skip=true) would erase previously-saved
  // contact data from an interrupted onboarding session.
  async function finish() {
    setError(null);
    try {
      setSaving(true);
      const userId = await getCurrentUserId();
      await upsertProfile(userId, {
        emergency_contact_name:         contactName.trim() || null,
        emergency_contact_phone: contactPhoneNumber.trim()
          ? `${contactPhoneCountry.dial} ${contactPhoneNumber.trim()}`
          : null,
        emergency_contact_relationship: contactRel.trim() || null,
        onboarding_completed_at:        new Date().toISOString(),
      });

      onComplete();
    } catch (e: any) {
      captureException(e);
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const anyFilled =
  contactName.trim() ||
  contactPhoneNumber.trim() ||
  contactRel.trim();

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
            <OnboardingProgressBar current={3} total={3} />

            <View style={styles.header}>
              <AppText style={styles.title}>Emergency contact</AppText>
              <AppText style={styles.subtitle}>
                Optional — you can add or update this any time in your profile.
              </AppText>
            </View>

            <Card style={styles.card}>
              <View style={styles.optionalBadge}>
                <AppText style={styles.optionalText}>All fields are optional</AppText>
              </View>

              <View style={styles.fields}>
                <TextField
                  label="Contact name"
                  placeholder="Full name"
                  value={contactName}
                  onChangeText={setContactName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  editable={!saving}
                />

                <PhoneField
                  label="Contact phone"
                  country={contactPhoneCountry}
                  number={contactPhoneNumber}
                  onCountryChange={setContactPhoneCountry}
                  onNumberChange={setContactPhoneNumber}
                  editable={!saving}
                  returnKeyType="next"
                />

                <TextField
                  label="Relationship"
                  placeholder="e.g. Spouse, Parent, Sibling"
                  value={contactRel}
                  onChangeText={setContactRel}
                  autoCapitalize="words"
                  returnKeyType="done"
                  editable={!saving}
                />
              </View>

              <ErrorBanner message={error} />

              <View style={styles.actions}>
                <SecondaryButton
                  label="Back"
                  onPress={() => navigation.goBack()}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label={saving ? "Finishing…" : "Done"}
                  onPress={finish}
                  disabled={saving}
                  tone="teal"
                  style={{ flex: 2 }}
                />
              </View>

              {!anyFilled ? (
                <>
                  <GhostButton
                    label="Skip for now"
                    onPress={finish}
                    disabled={saving}
                  />
                  <AppText style={styles.skipNote}>
                    No worries! You can always add this later from your profile. You can also connect Apple Health any time.
                  </AppText>
                </>
              ) : null}
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
  skipNote: {
    fontSize: typescale.size.xs,
    color: c.subtle,
    textAlign: "center",
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    marginTop: -spacing.xs,
  },
}));
