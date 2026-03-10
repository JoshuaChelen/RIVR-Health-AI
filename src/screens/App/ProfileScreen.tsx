import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Modal,
  SafeAreaView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { supabase } from "../../lib/supabase";
import { getProfile, upsertProfile, type UserProfile } from "../../lib/profile";
import { getCurrentUserId } from "../../lib/auth";
import { parseDob, dobIsoToInput, dobIsoToDisplay, computeAge, formatDobAsTyped } from "../../lib/profileUtils";
import { PhoneField, parseStoredPhone, COUNTRIES, type Country } from "../../components/ui/Primitives/PhoneField";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { TextField } from "../../components/ui/Primitives/TextField";
import { OptionPills } from "../../components/ui/Onboarding/OptionPills";
import { SectionCard } from "../../components/ui/Profile/SectionCard";
import { safeList } from "../../lib/profileMedical";

import { colors, radius, shadows, spacing, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "Profile">;
type EditSection = "basic" | "personal" | "contact" | "emergency";

// ─── Completion config ────────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof UserProfile)[] = [
  "first_name", "last_name", "date_of_birth", "sex_or_gender",
  "occupation", "marital_status", "email", "mobile_phone",
];
const ALL_FIELDS: (keyof UserProfile)[] = [
  ...REQUIRED_FIELDS,
  "number_of_children", "emergency_contact_name",
  "emergency_contact_phone", "emergency_contact_relationship",
];
const FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  sex_or_gender: "Sex or gender",
  occupation: "Occupation",
  marital_status: "Marital status",
  email: "Email",
  mobile_phone: "Mobile phone",
  number_of_children: "No. of children",
  emergency_contact_name: "Emergency name",
  emergency_contact_phone: "Emergency phone",
  emergency_contact_relationship: "Emergency relationship",
};

function isFilled(val: any): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "string") return val.trim().length > 0;
  return true;
}

function getCompletion(profile: UserProfile) {
  const filled = ALL_FIELDS.filter((f) => isFilled(profile[f]));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !isFilled(profile[f]));
  return {
    filledCount: filled.length,
    total: ALL_FIELDS.length,
    percent: Math.round((filled.length / ALL_FIELDS.length) * 100),
    missingRequired,
    isComplete: missingRequired.length === 0 && filled.length === ALL_FIELDS.length,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const SEX_OPTIONS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const MARITAL_OPTIONS = ["Single", "Married", "Partnered", "Divorced", "Widowed"];

function DataRow({ label, value }: { label: string; value?: string | number | null }) {
  const text =
    value !== null && value !== undefined && String(value).trim()
      ? String(value)
      : null;
  return (
    <View style={dr.row}>
      <AppText variant="label" style={dr.label}>{label}</AppText>
      <AppText style={[dr.value, !text && dr.empty]} numberOfLines={2}>
        {text ?? "—"}
      </AppText>
    </View>
  );
}

const dr = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    color: colors.muted,
    paddingTop: 1,
  },
  value: {
    flex: 1.5,
    textAlign: "right",
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium as any,
    color: colors.text,
  },
  empty: {
    color: colors.subtle,
    fontWeight: typescale.weight.regular as any,
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export function ProfileScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<EditSection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Edit drafts (one per section) ──────────────────────────
  const [basicDraft, setBasicDraft] = useState({
    firstName: "", lastName: "", dob: "", sex: null as string | null,
  });
  const dobPrevRef = useRef("");
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [dobPickerDate, setDobPickerDate] = useState(new Date(1990, 0, 1));
  const [personalDraft, setPersonalDraft] = useState({
    occupation: "", marital: null as string | null, children: "",
  });
  const [contactDraft, setContactDraft] = useState({
    email: "",
    phoneCountry: COUNTRIES[0] as Country,
    phoneNumber: "",
  });
  const [emergencyDraft, setEmergencyDraft] = useState({ name: "", phone: "", rel: "" });

  // ── Load ────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const userId = await getCurrentUserId();
          if (!active) return;
          const p = await getProfile(userId);
          if (active) setProfile(p);
        } catch {
          // Not authenticated or network error — handled by finally
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Edit helpers ────────────────────────────────────────────
  function startEdit(section: EditSection) {
    setSaveError(null);
    switch (section) {
      case "basic": {
        const dobInput = profile?.date_of_birth ? dobIsoToInput(profile.date_of_birth) : "";
        dobPrevRef.current = dobInput;
        setBasicDraft({
          firstName: profile?.first_name ?? "",
          lastName:  profile?.last_name ?? "",
          dob:       dobInput,
          sex:       profile?.sex_or_gender ?? null,
        });
        if (profile?.date_of_birth) {
          const [y, m, d] = profile.date_of_birth.split("-").map(Number);
          setDobPickerDate(new Date(y, m - 1, d));
        }
        break;
      }
      case "personal":
        setPersonalDraft({
          occupation: profile?.occupation ?? "",
          marital:    profile?.marital_status ?? null,
          children:   profile?.number_of_children != null ? String(profile.number_of_children) : "",
        });
        break;
      case "contact": {
        const { country, number } = parseStoredPhone(profile?.mobile_phone ?? "");
        setContactDraft({
          email: profile?.email ?? "",
          phoneCountry: country,
          phoneNumber: number,
        });
        break;
      }
      case "emergency":
        setEmergencyDraft({
          name:  profile?.emergency_contact_name ?? "",
          phone: profile?.emergency_contact_phone ?? "",
          rel:   profile?.emergency_contact_relationship ?? "",
        });
        break;
    }
    setEditingSection(section);
  }

  function cancelEdit() {
    setSaveError(null);
    setEditingSection(null);
  }

  async function saveSection(
    patch: Parameters<typeof upsertProfile>[1]
  ) {
    setSaveError(null);
    setSaving(true);
    try {
      const userId = await getCurrentUserId();
      const updated = await upsertProfile(userId, patch);
      setProfile(updated);
      setEditingSection(null);
    } catch (e: any) {
      setSaveError(e?.message ?? "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Section save handlers ───────────────────────────────────
  async function saveBasic() {
    const dobIso = parseDob(basicDraft.dob);
    if (!dobIso) {
      setSaveError("Enter a valid date in MM/DD/YYYY format.");
      return;
    }
    await saveSection({
      first_name:    basicDraft.firstName.trim(),
      last_name:     basicDraft.lastName.trim(),
      date_of_birth: dobIso,
      sex_or_gender: basicDraft.sex,
    });
  }

  async function savePersonal() {
    const childNum = personalDraft.children.trim()
      ? parseInt(personalDraft.children.trim(), 10)
      : null;
    if (personalDraft.children.trim() && (isNaN(childNum!) || childNum! < 0)) {
      setSaveError("Number of children must be a non-negative number.");
      return;
    }
    await saveSection({
      occupation:         personalDraft.occupation.trim() || null,
      marital_status:     personalDraft.marital,
      number_of_children: childNum,
    });
  }

  async function saveContact() {
    const fullPhone = contactDraft.phoneNumber.trim()
      ? `${contactDraft.phoneCountry.dial} ${contactDraft.phoneNumber.trim()}`
      : null;
    await saveSection({
      email:        contactDraft.email.trim() || null,
      mobile_phone: fullPhone,
    });
  }

  async function saveEmergency() {
    await saveSection({
      emergency_contact_name:         emergencyDraft.name.trim() || null,
      emergency_contact_phone:        emergencyDraft.phone.trim() || null,
      emergency_contact_relationship: emergencyDraft.rel.trim() || null,
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      </Screen>
    );
  }

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Your Profile";
  const initials =
    (profile?.first_name?.[0] ?? "").toUpperCase() +
    (profile?.last_name?.[0] ?? "").toUpperCase();
  const completion = profile ? getCompletion(profile) : null;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
        >

          {/* ── Profile header ──────────────────────────────── */}
          <View style={styles.header}>
            <View style={styles.avatarCircle}>
              <AppText style={styles.avatarText}>
                {initials || "?"}
              </AppText>
            </View>

            <View style={styles.headerText}>
              <AppText style={styles.headerName}>{fullName}</AppText>
              {profile?.email ? (
                <AppText style={styles.headerEmail}>{profile.email}</AppText>
              ) : null}
            </View>

            {completion && (
              <View style={styles.completionRow}>
                <View style={styles.completionBarTrack}>
                  <View
                    style={[
                      styles.completionBarFill,
                      { width: `${completion.percent}%` as any },
                    ]}
                  />
                </View>
                <AppText style={styles.completionLabel}>
                  {completion.filledCount} of {completion.total} fields complete
                </AppText>
              </View>
            )}
          </View>

          {completion?.isComplete && (
            <View style={styles.completeBadge}>
              <AppText style={styles.completeBadgeText}>✓ Profile complete</AppText>
            </View>
          )}

          {/* ── Medical Profile entry ─────────────────────── */}
          <Pressable
            style={({ pressed }) => [styles.medCard, pressed && styles.medCardPressed]}
            onPress={() => navigation.navigate("MedicalProfile")}
          >
            <View style={styles.medAccent} />
            <View style={styles.medIconWrap}>
              <AppText style={styles.medIcon}>🏥</AppText>
            </View>
            <View style={styles.medTextBlock}>
              <AppText style={styles.medTitle}>Medical Profile</AppText>
              <AppText style={styles.medSub} numberOfLines={1}>
                {medicalSummary(profile)}
              </AppText>
            </View>
            <AppText style={styles.medChevron}>›</AppText>
          </Pressable>

          {/* ── Story entry ───────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [styles.storyCard, pressed && styles.storyCardPressed]}
            onPress={() => navigation.navigate("Story")}
          >
            <View style={styles.storyAccent} />
            <View style={styles.storyIconWrap}>
              <AppText style={styles.storyIcon}>✨</AppText>
            </View>
            <View style={styles.storyTextBlock}>
              <AppText style={styles.storyTitle}>Your Health Story</AppText>
              <AppText style={styles.storySub} numberOfLines={1}>
                {storySummary(profile)}
              </AppText>
            </View>
            <AppText style={styles.storyChevron}>›</AppText>
          </Pressable>

          {/* ── Section 1: Basic Information ──────────────── */}
          <SectionCard
            icon="👤"
            title="Basic Information"
            editing={editingSection === "basic"}
            onEdit={() => startEdit("basic")}
            onCancel={cancelEdit}
            onSave={saveBasic}
            saving={saving}
            error={editingSection === "basic" ? saveError : null}
            canSave={
              basicDraft.firstName.trim().length > 0 &&
              basicDraft.lastName.trim().length > 0 &&
              !!parseDob(basicDraft.dob) &&
              basicDraft.sex !== null
            }
          >
            {editingSection === "basic" ? (
              <View style={styles.formFields}>
                <View style={styles.formRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      label="First name"
                      placeholder="Jane"
                      value={basicDraft.firstName}
                      onChangeText={(v) => setBasicDraft((d) => ({ ...d, firstName: v }))}
                      autoCapitalize="words"
                      autoCorrect={false}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      label="Last name"
                      placeholder="Smith"
                      value={basicDraft.lastName}
                      onChangeText={(v) => setBasicDraft((d) => ({ ...d, lastName: v }))}
                      autoCapitalize="words"
                      autoCorrect={false}
                    />
                  </View>
                </View>
                <TextField
                  label="Date of birth"
                  placeholder="MM/DD/YYYY"
                  value={basicDraft.dob}
                  onChangeText={(v) => {
                    const formatted = formatDobAsTyped(v, dobPrevRef.current);
                    dobPrevRef.current = formatted;
                    setBasicDraft((d) => ({ ...d, dob: formatted }));
                  }}
                  keyboardType="numbers-and-punctuation"
                  rightAccessory={
                    <Pressable
                      onPress={() => {
                        const parsed = parseDob(basicDraft.dob);
                        if (parsed) {
                          const [y, m, d] = parsed.split("-").map(Number);
                          setDobPickerDate(new Date(y, m - 1, d));
                        }
                        setShowDobPicker(true);
                      }}
                      style={({ pressed }) => [styles.calIcon, pressed && { opacity: 0.6 }]}
                      hitSlop={8}
                    >
                      <AppText style={styles.calIconText}>📅</AppText>
                    </Pressable>
                  }
                />
                <View style={styles.pillGroup}>
                  <AppText variant="label">Sex or gender</AppText>
                  <OptionPills
                    options={SEX_OPTIONS}
                    selected={basicDraft.sex}
                    onSelect={(v) => setBasicDraft((d) => ({ ...d, sex: v }))}
                  />
                </View>
              </View>
            ) : (
              <View>
                <DataRow label="First name"    value={profile?.first_name} />
                <View style={styles.rowDivider} />
                <DataRow label="Last name"     value={profile?.last_name} />
                <View style={styles.rowDivider} />
                <DataRow
                  label="Date of birth"
                  value={profile?.date_of_birth ? dobIsoToDisplay(profile.date_of_birth) : null}
                />
                <View style={styles.rowDivider} />
                <DataRow
                  label="Age"
                  value={profile?.date_of_birth ? `${computeAge(profile.date_of_birth)} years` : null}
                />
                <View style={styles.rowDivider} />
                <DataRow label="Sex or gender" value={profile?.sex_or_gender} />
              </View>
            )}
          </SectionCard>

          {/* ── Section 2: Personal Details ────────────────── */}
          <SectionCard
            icon="🏡"
            title="Personal Details"
            editing={editingSection === "personal"}
            onEdit={() => startEdit("personal")}
            onCancel={cancelEdit}
            onSave={savePersonal}
            saving={saving}
            error={editingSection === "personal" ? saveError : null}
          >
            {editingSection === "personal" ? (
              <View style={styles.formFields}>
                <TextField
                  label="Occupation"
                  placeholder="e.g. Software engineer, Nurse"
                  value={personalDraft.occupation}
                  onChangeText={(v) => setPersonalDraft((d) => ({ ...d, occupation: v }))}
                  autoCapitalize="words"
                />
                <View style={styles.pillGroup}>
                  <AppText variant="label">Marital status</AppText>
                  <OptionPills
                    options={MARITAL_OPTIONS}
                    selected={personalDraft.marital}
                    onSelect={(v) => setPersonalDraft((d) => ({ ...d, marital: v }))}
                  />
                </View>
                <TextField
                  label="Number of children"
                  placeholder="Optional"
                  value={personalDraft.children}
                  onChangeText={(v) => setPersonalDraft((d) => ({ ...d, children: v }))}
                  keyboardType="number-pad"
                />
              </View>
            ) : (
              <View>
                <DataRow label="Occupation"      value={profile?.occupation} />
                <View style={styles.rowDivider} />
                <DataRow label="Marital status"  value={profile?.marital_status} />
                <View style={styles.rowDivider} />
                <DataRow
                  label="Children"
                  value={profile?.number_of_children != null ? String(profile.number_of_children) : null}
                />
              </View>
            )}
          </SectionCard>

          {/* ── Section 3: Contact Information ─────────────── */}
          <SectionCard
            icon="📱"
            title="Contact Information"
            editing={editingSection === "contact"}
            onEdit={() => startEdit("contact")}
            onCancel={cancelEdit}
            onSave={saveContact}
            saving={saving}
            error={editingSection === "contact" ? saveError : null}
          >
            {editingSection === "contact" ? (
              <View style={styles.formFields}>
                <TextField
                  label="Email"
                  placeholder="you@example.com"
                  value={contactDraft.email}
                  onChangeText={(v) => setContactDraft((d) => ({ ...d, email: v }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  disabled
                />
                <PhoneField
                  label="Mobile phone"
                  country={contactDraft.phoneCountry}
                  number={contactDraft.phoneNumber}
                  onCountryChange={(c) => setContactDraft((d) => ({ ...d, phoneCountry: c }))}
                  onNumberChange={(n) => setContactDraft((d) => ({ ...d, phoneNumber: n }))}
                  editable={!saving}
                />
              </View>
            ) : (
              <View>
                <DataRow label="Email"        value={profile?.email} />
                <View style={styles.rowDivider} />
                <DataRow label="Mobile phone" value={profile?.mobile_phone} />
              </View>
            )}
          </SectionCard>

          {/* ── Section 4: Emergency Contact ───────────────── */}
          <SectionCard
            icon="🚨"
            title="Emergency Contact"
            editing={editingSection === "emergency"}
            onEdit={() => startEdit("emergency")}
            onCancel={cancelEdit}
            onSave={saveEmergency}
            saving={saving}
            error={editingSection === "emergency" ? saveError : null}
          >
            {editingSection === "emergency" ? (
              <View style={styles.formFields}>
                <TextField
                  label="Contact name"
                  placeholder="Full name"
                  value={emergencyDraft.name}
                  onChangeText={(v) => setEmergencyDraft((d) => ({ ...d, name: v }))}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
                <TextField
                  label="Contact phone"
                  placeholder="+1 (555) 000-0000"
                  value={emergencyDraft.phone}
                  onChangeText={(v) => setEmergencyDraft((d) => ({ ...d, phone: v }))}
                  keyboardType="phone-pad"
                />
                <TextField
                  label="Relationship"
                  placeholder="e.g. Spouse, Parent, Sibling"
                  value={emergencyDraft.rel}
                  onChangeText={(v) => setEmergencyDraft((d) => ({ ...d, rel: v }))}
                  autoCapitalize="words"
                />
              </View>
            ) : (
              <View>
                <DataRow label="Name"         value={profile?.emergency_contact_name} />
                <View style={styles.rowDivider} />
                <DataRow label="Phone"        value={profile?.emergency_contact_phone} />
                <View style={styles.rowDivider} />
                <DataRow label="Relationship" value={profile?.emergency_contact_relationship} />
              </View>
            )}
          </SectionCard>

          {/* ── Sign out ───────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.5 }]}
            onPress={async () => { await supabase.auth.signOut(); }}
          >
            <AppText style={styles.signOutText}>Sign out</AppText>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── DOB date picker modal ─────────────────────────── */}
      <ProfileDobPickerModal
        visible={showDobPicker}
        date={dobPickerDate}
        onConfirm={(d) => {
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          const yyyy = String(d.getFullYear());
          const formatted = `${mm}/${dd}/${yyyy}`;
          dobPrevRef.current = formatted;
          setBasicDraft((prev) => ({ ...prev, dob: formatted }));
          setDobPickerDate(d);
          setShowDobPicker(false);
        }}
        onCancel={() => setShowDobPicker(false)}
      />
    </Screen>
  );
}

// ─── Medical summary helper ───────────────────────────────────────────────────

function storySummary(profile: UserProfile | null): string {
  if (!profile?.story_answers) return "Reflect on your personal health context";
  const count = Object.values(profile.story_answers).filter((v) => v?.trim()).length;
  if (count === 0) return "Reflect on your personal health context";
  if (count === 10) return "All 10 questions answered";
  return `${count} of 10 questions answered`;
}

function medicalSummary(profile: UserProfile | null): string {
  if (!profile) return "Add medical history, medications & more";
  const parts: string[] = [];
  const ac = safeList(profile.allergies).length;
  const mc = safeList(profile.medications).length;
  const hc = safeList(profile.medical_history).length;
  const hasLifestyle = !!(profile.smoking_status || profile.alcohol_use || profile.exercise_level);
  if (ac) parts.push(`${ac} allerg${ac === 1 ? "y" : "ies"}`);
  if (mc) parts.push(`${mc} medication${mc !== 1 ? "s" : ""}`);
  if (hc) parts.push(`${hc} condition${hc !== 1 ? "s" : ""}`);
  if (hasLifestyle) parts.push("lifestyle recorded");
  return parts.length ? parts.join(" · ") : "Add medical history, medications & more";
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.md,
  },

  // ── Header ──
  header: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
    ...shadows.card,
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.xs,
  },
  avatarText: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold as any,
    color: "#fff",
    letterSpacing: 1,
  },
  headerText: {
    alignItems: "center",
    gap: 4,
  },
  headerName: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold as any,
    color: colors.text,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  headerEmail: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
  },
  completionRow: {
    width: "100%",
    gap: spacing.xs,
  },
  completionBarTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  completionBarFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  completionLabel: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    textAlign: "right",
  },

  // ── Nudge card ──
  nudgeCard: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  nudgeTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold as any,
    color: colors.teal,
  },
  nudgeSub: {
    fontSize: typescale.size.sm,
    color: colors.teal,
    opacity: 0.8,
  },
  nudgePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: 2,
  },
  nudgePill: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  nudgePillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.medium as any,
    color: colors.teal,
  },

  // ── Complete badge ──
  completeBadge: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  completeBadgeText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: colors.success,
  },

  // ── Section form ──
  formFields: {
    gap: spacing.md,
  },
  formRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pillGroup: {
    gap: spacing.xs,
  },

  // ── Row dividers ──
  rowDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },

  // ── Medical entry card ──
  medCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    ...shadows.xs,
  },
  medCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  medAccent: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: colors.teal,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    marginRight: spacing.xs,
    flexShrink: 0,
  },
  medIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  medIcon: { fontSize: 16, lineHeight: 22 },
  medTextBlock: { flex: 1, gap: 3 },
  medTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold as any,
    color: colors.text,
  },
  medSub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  medChevron: {
    fontSize: 22,
    color: colors.teal,
    lineHeight: 28,
    flexShrink: 0,
  },

  // ── Story entry card (blue accent) ──
  storyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    ...shadows.xs,
  },
  storyCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  storyAccent: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: colors.blue,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    marginRight: spacing.xs,
    flexShrink: 0,
  },
  storyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.blueSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  storyIcon: { fontSize: 16, lineHeight: 22 },
  storyTextBlock: { flex: 1, gap: 3 },
  storyTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold as any,
    color: colors.text,
  },
  storySub: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  storyChevron: {
    fontSize: 22,
    color: colors.blue,
    lineHeight: 28,
    flexShrink: 0,
  },

  // ── Sign out ──
  signOut: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  signOutText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium as any,
    color: colors.subtle,
  },

  // ── DOB calendar icon ──
  calIcon: { paddingLeft: 4 },
  calIconText: { fontSize: 18, lineHeight: 24 },
});

// ─── ProfileDobPickerModal ────────────────────────────────────────────────────
// Mirrors OnboardingStep1Screen's DatePickerModal — uses the native package when
// available and falls back to an arrow-based spinner otherwise.

let NativeDatePicker: any = null;
try { NativeDatePicker = require("@react-native-community/datetimepicker").default; } catch { /* not installed */ }

const DP_MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function ProfileDobPickerModal({
  visible, date, onConfirm, onCancel,
}: {
  visible: boolean;
  date: Date;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}) {
  const [local, setLocal] = useState(date);
  useEffect(() => { setLocal(date); }, [date]);

  if (!visible) return null;

  if (NativeDatePicker) {
    if (Platform.OS === "android") {
      return (
        <NativeDatePicker
          value={local}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={(_: any, d?: Date) => { if (d) onConfirm(d); else onCancel(); }}
        />
      );
    }
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
        <Pressable style={dp2.overlay} onPress={onCancel} />
        <SafeAreaView style={dp2.sheet}>
          <View style={dp2.handle} />
          <View style={dp2.header}>
            <Pressable onPress={onCancel} style={dp2.btn}>
              <AppText style={dp2.cancel}>Cancel</AppText>
            </Pressable>
            <AppText style={dp2.title}>Date of birth</AppText>
            <Pressable onPress={() => onConfirm(local)} style={dp2.btn}>
              <AppText style={dp2.done}>Done</AppText>
            </Pressable>
          </View>
          <NativeDatePicker
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

  // Fallback arrow spinner
  const y = local.getFullYear(), m = local.getMonth(), d = local.getDate();
  function adj(field: "y"|"m"|"d", delta: number) {
    const n = new Date(local);
    if (field === "y") n.setFullYear(y + delta);
    if (field === "m") n.setMonth(m + delta);
    if (field === "d") n.setDate(d + delta);
    if (n > new Date() || n < new Date(1900, 0, 1)) return;
    setLocal(n);
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={dp2.overlay} onPress={onCancel} />
      <SafeAreaView style={dp2.sheet}>
        <View style={dp2.handle} />
        <View style={dp2.header}>
          <Pressable onPress={onCancel} style={dp2.btn}><AppText style={dp2.cancel}>Cancel</AppText></Pressable>
          <AppText style={dp2.title}>Date of birth</AppText>
          <Pressable onPress={() => onConfirm(local)} style={dp2.btn}><AppText style={dp2.done}>Done</AppText></Pressable>
        </View>
        <View style={dp2.row}>
          {(["m","d","y"] as const).map((field) => {
            const val = field === "m" ? DP_MONTHS[m].slice(0, 3) : field === "d" ? String(d).padStart(2,"0") : String(y);
            return (
              <View key={field} style={dp2.col}>
                <Pressable onPress={() => adj(field, -1)} style={dp2.arrowBtn}><AppText style={dp2.arrow}>▲</AppText></Pressable>
                <AppText style={dp2.val}>{val}</AppText>
                <Pressable onPress={() => adj(field, 1)} style={dp2.arrowBtn}><AppText style={dp2.arrow}>▼</AppText></Pressable>
              </View>
            );
          })}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const dp2 = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm, paddingBottom: spacing.xl,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: "center", marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight, marginBottom: spacing.xs,
  },
  title: { fontSize: typescale.size.base, fontWeight: typescale.weight.semibold as any, color: colors.text },
  btn: { paddingVertical: 4, paddingHorizontal: spacing.xs },
  cancel: { fontSize: typescale.size.base, color: colors.muted },
  done: { fontSize: typescale.size.base, fontWeight: typescale.weight.semibold as any, color: colors.teal },
  row: { flexDirection: "row", justifyContent: "center", gap: spacing.xl, paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  col: { alignItems: "center", gap: spacing.sm, flex: 1 },
  arrowBtn: { padding: spacing.sm },
  arrow: { fontSize: typescale.size.sm, color: colors.teal },
  val: { fontSize: typescale.size.lg, fontWeight: typescale.weight.bold as any, color: colors.text, minWidth: 60, textAlign: "center" },
});
