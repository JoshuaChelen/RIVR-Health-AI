import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Pressable,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OnboardingStackParamList } from "../../navigation/onboardingTypes";

import { getProfile, upsertProfile } from "../../lib/profile";
import { getCurrentUser } from "../../lib/auth";
import { parseDob, dobIsoToInput, formatDobAsTyped } from "../../lib/profileUtils";
import { captureException } from "../../lib/sentry";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { TextField } from "../../components/ui/Primitives/TextField";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { Card } from "../../components/ui/Primitives/Card";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { OnboardingProgressBar } from "../../components/ui/Onboarding/OnboardingProgressBar";
import { OptionPills } from "../../components/ui/Onboarding/OptionPills";
import { DatePickerModal } from "../../components/ui/Primitives/DatePickerModal";
import { useOnboardingStyles } from "./onboardingStyles";

import { spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

type Props = NativeStackScreenProps<OnboardingStackParamList, "OnboardingStep1">;

const SEX_OPTIONS = ["Male", "Female", "Non-binary", "Prefer not to say"];

// ─── Screen ───────────────────────────────────────────────────────────────────

export function OnboardingStep1Screen({ navigation }: Props) {
  const styles = { ...useOnboardingStyles(), ...useStyles() };
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [dob, setDob]             = useState("");
  const prevDobRef                = useRef("");
  const [dobError, setDobError]   = useState<string | null>(null);
  const [sex, setSex]             = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ── Date picker state ──────────────────────────────────────────────────────
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate]         = useState(new Date(1990, 0, 1));

  // ── Load existing data ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) return;
        const profile = await getProfile(user.id);
        if (profile) {
          setFirstName(profile.first_name ?? "");
          setLastName(profile.last_name ?? "");
          if (profile.date_of_birth) {
            const formatted = dobIsoToInput(profile.date_of_birth);
            setDob(formatted);
            prevDobRef.current = formatted;
            // Also seed the picker
            const [y, m, d] = profile.date_of_birth.split("-").map(Number);
            setPickerDate(new Date(y, m - 1, d));
          }
          setSex(profile.sex_or_gender ?? null);
        }
      } catch (e) {
        captureException(e);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleDobChange(raw: string) {
    const formatted = formatDobAsTyped(raw, prevDobRef.current);
    prevDobRef.current = formatted;
    setDob(formatted);
    setDobError(null);
  }

  function handleDobBlur() {
    if (!dob.trim()) { setDobError(null); return; }
    setDobError(parseDob(dob) ? null : "Enter a valid date: MM/DD/YYYY");
  }

  function openDatePicker() {
    // Seed picker with current valid date or default
    const parsed = parseDob(dob);
    if (parsed) {
      const [y, m, d] = parsed.split("-").map(Number);
      setPickerDate(new Date(y, m - 1, d));
    }
    setShowDatePicker(true);
  }

  function confirmDatePicker(date: Date) {
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    const formatted = `${mm}/${dd}/${yyyy}`;
    prevDobRef.current = formatted;
    setDob(formatted);
    setDobError(null);
    setPickerDate(date);
    setShowDatePicker(false);
  }

  const isValid =
    !loadingProfile &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    !!parseDob(dob) &&
    sex !== null;

  async function handleNext() {
    setError(null);
    const dobIso = parseDob(dob);
    if (!dobIso) {
      setDobError("Enter a valid date: MM/DD/YYYY");
      return;
    }
    try {
      setSaving(true);
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated.");
      await upsertProfile(user.id, {
        first_name:    firstName.trim(),
        last_name:     lastName.trim(),
        date_of_birth: dobIso,
        sex_or_gender: sex!,
      });
      navigation.navigate("OnboardingStep2");
    } catch (e: any) {
      captureException(e);
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
            <OnboardingProgressBar current={1} total={3} />

            <View style={styles.header}>
              <AppText style={styles.title}>Tell us about yourself</AppText>
              <AppText style={styles.subtitle}>
                This helps us personalize your health experience.
              </AppText>
            </View>

            <Card style={styles.card}>
              <View style={styles.fields}>

                {/* First + Last name row */}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="First name"
                      placeholder="Jane"
                      value={firstName}
                      onChangeText={setFirstName}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="next"
                      editable={!saving}
                      maxLength={100}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Last name"
                      placeholder="Smith"
                      value={lastName}
                      onChangeText={setLastName}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="next"
                      editable={!saving}
                      maxLength={100}
                    />
                  </View>
                </View>

                {/* Date of birth */}
                <View>
                  <TextField
                    label="Date of birth"
                    placeholder="MM/DD/YYYY"
                    value={dob}
                    onChangeText={handleDobChange}
                    onBlur={handleDobBlur}
                    keyboardType="numbers-and-punctuation"
                    returnKeyType="done"
                    editable={!saving}
                    rightAccessory={
                      <Pressable
                        onPress={openDatePicker}
                        style={({ pressed }) => [styles.calIcon, pressed && { opacity: 0.6 }]}
                        hitSlop={8}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel="Open date picker"
                      >
                        <Ionicons name="calendar-outline" size={18} color={colors.text} />
                      </Pressable>
                    }
                  />
                  {dobError ? (
                    <AppText style={styles.fieldError}>{dobError}</AppText>
                  ) : (
                    <AppText variant="caption" style={styles.hint}>
                      Age is computed from your date of birth.
                    </AppText>
                  )}
                </View>

                {/* Sex or gender */}
                <View style={styles.pillGroup}>
                  <AppText variant="label">Sex or gender</AppText>
                  <OptionPills options={SEX_OPTIONS} selected={sex} onSelect={setSex} />
                </View>
              </View>

              <ErrorBanner message={error} />

              <PrimaryButton
                label={saving ? "Saving…" : "Continue"}
                onPress={handleNext}
                disabled={!isValid || saving}
                tone="teal"
              />
            </Card>
            <AppText style={styles.footer}>
                Your information is encrypted and only visible to you.
              </AppText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Date picker modal ──────────────────────────────────────────────── */}
      <DatePickerModal
        visible={showDatePicker}
        date={pickerDate}
        onConfirm={confirmDatePicker}
        onCancel={() => setShowDatePicker(false)}
      />
    </Screen>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  row:       { flexDirection: "row", gap: spacing.sm },
  calIcon:   { paddingLeft: 4 },
  hint: {
    marginTop: 5,
    color: c.subtle,
  },
  fieldError: {
    marginTop: 5,
    fontSize: typescale.size.sm,
    color: c.danger,
    fontWeight: typescale.weight.medium as any,
  },
}));
