import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Pressable,
  Modal,
  SafeAreaView,
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

import { radius, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

type Props = NativeStackScreenProps<OnboardingStackParamList, "OnboardingStep1">;

const SEX_OPTIONS = ["Male", "Female", "Non-binary", "Prefer not to say"];

// ─── Screen ───────────────────────────────────────────────────────────────────

export function OnboardingStep1Screen({ navigation }: Props) {
  const { styles, dp } = useStyles();
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

// ─── DatePickerModal ──────────────────────────────────────────────────────────
//
// Uses @react-native-community/datetimepicker when available.
// Falls back to a simple numeric scroll-wheel built from native Picker (inline).
// Install the package: npx expo install @react-native-community/datetimepicker
//

let DateTimePicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DateTimePicker = require("@react-native-community/datetimepicker").default;
} catch {
  // package not installed — fallback renders below
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function DatePickerModal({
  visible,
  date,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  date: Date;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}) {
  const { dp } = useStyles();
  const { colors } = useTheme();
  const [local, setLocal] = useState(date);
  // Keep local in sync when parent resets the date
  useEffect(() => { setLocal(date); }, [date]);

  if (!visible) return null;

  // ── If package is available: native DateTimePicker ─────────────────────────
  if (DateTimePicker) {
    if (Platform.OS === "android") {
      // Android shows a native dialog — no Modal wrapper needed
      return (
        <DateTimePicker
          value={local}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={(_: any, d?: Date) => {
            if (d) onConfirm(d);
            else onCancel();
          }}
        />
      );
    }

    // iOS — wrap in a bottom sheet Modal
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
        <Pressable style={dp.overlay} onPress={onCancel} />
        <SafeAreaView style={dp.sheet}>
          <View style={dp.sheetHandle} />
          <View style={dp.sheetHeader}>
            <Pressable onPress={onCancel} style={dp.sheetBtn}>
              <AppText style={dp.sheetBtnCancel}>Cancel</AppText>
            </Pressable>
            <AppText style={dp.sheetTitle}>Date of birth</AppText>
            <Pressable onPress={() => onConfirm(local)} style={dp.sheetBtn}>
              <AppText style={dp.sheetBtnDone}>Done</AppText>
            </Pressable>
          </View>
          <DateTimePicker
            value={local}
            mode="date"
            display="spinner"
            maximumDate={new Date()}
            minimumDate={new Date(1900, 0, 1)}
            onChange={(_: any, d?: Date) => d && setLocal(d)}
            style={{ height: 216 }}
          />
        </SafeAreaView>
      </Modal>
    );
  }

  // ── Fallback: simple text-based month/year selector ────────────────────────
  const year  = local.getFullYear();
  const month = local.getMonth();
  const day   = local.getDate();

  function adjust(field: "y" | "m" | "d", delta: number) {
    const n = new Date(local);
    if (field === "y") n.setFullYear(year + delta);
    if (field === "m") n.setMonth(month + delta);
    if (field === "d") n.setDate(day + delta);
    if (n > new Date()) return;
    if (n < new Date(1900, 0, 1)) return;
    setLocal(n);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={dp.overlay} onPress={onCancel} />
      <SafeAreaView style={dp.sheet}>
        <View style={dp.sheetHandle} />
        <View style={dp.sheetHeader}>
          <Pressable onPress={onCancel} style={dp.sheetBtn}>
            <AppText style={dp.sheetBtnCancel}>Cancel</AppText>
          </Pressable>
          <AppText style={dp.sheetTitle}>Date of birth</AppText>
          <Pressable onPress={() => onConfirm(local)} style={dp.sheetBtn}>
            <AppText style={dp.sheetBtnDone}>Done</AppText>
          </Pressable>
        </View>

        <View style={dp.fallbackRow}>
          {/* Month */}
          <View style={dp.fallbackCol}>
            <Pressable onPress={() => adjust("m", 1)} style={dp.arrowBtn}>
              <Ionicons name="chevron-up" size={18} color={colors.teal} />
            </Pressable>
            <AppText style={dp.fallbackValue}>{MONTHS[month].slice(0, 3)}</AppText>
            <Pressable onPress={() => adjust("m", -1)} style={dp.arrowBtn}>
              <Ionicons name="chevron-down" size={18} color={colors.teal} />
            </Pressable>
          </View>

          {/* Day */}
          <View style={dp.fallbackCol}>
            <Pressable onPress={() => adjust("d", 1)} style={dp.arrowBtn}>
              <Ionicons name="chevron-up" size={18} color={colors.teal} />
            </Pressable>
            <AppText style={dp.fallbackValue}>{String(day).padStart(2, "0")}</AppText>
            <Pressable onPress={() => adjust("d", -1)} style={dp.arrowBtn}>
              <Ionicons name="chevron-down" size={18} color={colors.teal} />
            </Pressable>
          </View>

          {/* Year */}
          <View style={dp.fallbackCol}>
            <Pressable onPress={() => adjust("y", 1)} style={dp.arrowBtn}>
              <Ionicons name="chevron-up" size={18} color={colors.teal} />
            </Pressable>
            <AppText style={dp.fallbackValue}>{year}</AppText>
            <Pressable onPress={() => adjust("y", -1)} style={dp.arrowBtn}>
              <Ionicons name="chevron-down" size={18} color={colors.teal} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((c) => ({
  dp: StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    sheet: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      alignSelf: "center",
      marginBottom: spacing.sm,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
      marginBottom: spacing.xs,
    },
    sheetTitle: {
      fontSize: typescale.size.base,
      fontWeight: typescale.weight.semibold as any,
      color: c.text,
    },
    sheetBtn: {
      paddingVertical: 4,
      paddingHorizontal: spacing.xs,
    },
    sheetBtnCancel: {
      fontSize: typescale.size.base,
      color: c.muted,
    },
    sheetBtnDone: {
      fontSize: typescale.size.base,
      fontWeight: typescale.weight.semibold as any,
      color: c.teal,
    },

    // Fallback picker
    fallbackRow: {
      flexDirection: "row",
      justifyContent: "center",
      gap: spacing.xl,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xl,
    },
    fallbackCol: {
      alignItems: "center",
      gap: spacing.sm,
      flex: 1,
    },
    arrowBtn: {
      padding: spacing.sm,
    },
    arrow: {
      fontSize: typescale.size.sm,
      color: c.teal,
    },
    fallbackValue: {
      fontSize: typescale.size.lg,
      fontWeight: typescale.weight.bold as any,
      color: c.text,
      minWidth: 60,
      textAlign: "center",
    },
  }),

  // ─── Styles ───────────────────────────────────────────────────────────────────

  styles: StyleSheet.create({
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
    fields:    { gap: spacing.md },
    row:       { flexDirection: "row", gap: spacing.sm },
    pillGroup: { gap: spacing.xs },
    calIcon:   { paddingLeft: 4 },
    calIconText: { display: "none" },
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
    footer: {
      textAlign: "center",
      fontSize: typescale.size.xs,
      color: c.subtle,
      lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
      paddingHorizontal: spacing.lg,
    },
  }),
}));
