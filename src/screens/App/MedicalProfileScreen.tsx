import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";

import { getProfile, upsertProfile, type UserProfile } from "../../lib/profile";
import { getCurrentUserId } from "../../lib/auth";
import {
  makeId, safeList, joinParts,
  type AllergyItem, type MedicationItem, type MedHistoryItem,
  type SurgeryItem, type FamilyHistoryItem,
  type HospitalizationItem, type SocialHistoryItem,
} from "../../lib/profileMedical";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { TextField } from "../../components/ui/Primitives/TextField";
import { GhostButton } from "../../components/ui/Primitives/GhostButton";
import { OptionPills } from "../../components/ui/Onboarding/OptionPills";
import { SectionCard } from "../../components/ui/Profile/SectionCard";

import { colors, radius, spacing, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "MedicalProfile">;
type MedSection =
  | "lifestyle" | "symptoms"
  | "allergies" | "medications" | "medHistory"
  | "surgery" | "familyHistory" | "hospitalizations" | "socialHistory";

// ─── Option constants ─────────────────────────────────────────────────────────

const SMOKING_OPTS  = ["Never", "Former", "Current", "Prefer not to say"];
const ALCOHOL_OPTS  = ["None", "Occasional", "Moderate", "Heavy", "Prefer not to say"];
const EXERCISE_OPTS = ["Sedentary", "Light", "Moderate", "Active", "Very Active"];
const SEVERITY_OPTS = ["Mild", "Moderate", "Severe"];
const RELATION_OPTS = ["Parent", "Sibling", "Grandparent", "Child", "Other"];

// ─── Shared sub-components ────────────────────────────────────────────────────

function DataRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={dr.row}>
      <AppText variant="label" style={dr.label}>{label}</AppText>
      <AppText style={[dr.value, !value && dr.empty]} numberOfLines={2}>
        {value?.trim() || "—"}
      </AppText>
    </View>
  );
}
const dr = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, gap: spacing.sm },
  label: { flex: 1, color: colors.muted, paddingTop: 1 },
  value: { flex: 1.5, textAlign: "right", fontSize: typescale.size.base, fontWeight: typescale.weight.medium as any, color: colors.text },
  empty: { color: colors.subtle, fontWeight: typescale.weight.regular as any },
});

function ItemRow({ primary, secondary, onDelete }: {
  primary: string; secondary?: string; onDelete?: () => void;
}) {
  return (
    <View style={ir.row}>
      <View style={ir.text}>
        <AppText style={ir.primary}>{primary}</AppText>
        {secondary ? <AppText style={ir.secondary}>{secondary}</AppText> : null}
      </View>
      {onDelete ? (
        <Pressable onPress={onDelete} style={({ pressed }) => [ir.del, pressed && { opacity: 0.6 }]} hitSlop={8}>
          <AppText style={ir.delText}>✕</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
const ir = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 9, gap: spacing.sm },
  text: { flex: 1, gap: 2 },
  primary: { fontSize: typescale.size.base, fontWeight: typescale.weight.medium as any, color: colors.text },
  secondary: { fontSize: typescale.size.xs, color: colors.muted },
  del: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.dangerSoft, alignItems: "center", justifyContent: "center" },
  delText: { fontSize: 11, fontWeight: typescale.weight.bold as any, color: colors.danger },
});

function ListDivider() {
  return <View style={{ height: 1, backgroundColor: colors.borderLight }} />;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <View style={eh.wrap}>
      <AppText style={eh.text}>{text}</AppText>
    </View>
  );
}
const eh = StyleSheet.create({
  wrap: { paddingVertical: spacing.md, alignItems: "center" },
  text: { fontSize: typescale.size.sm, color: colors.subtle, fontStyle: "italic" },
});

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [ab.btn, pressed && { opacity: 0.7 }]}
    >
      <AppText style={ab.text}>+ {label}</AppText>
    </Pressable>
  );
}
const ab = StyleSheet.create({
  btn: { paddingVertical: spacing.xs, paddingHorizontal: 2, alignSelf: "flex-start" },
  text: { fontSize: typescale.size.sm, fontWeight: typescale.weight.semibold as any, color: colors.teal },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export function MedicalProfileScreen(_: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<MedSection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Lifestyle drafts ──────────────────────────────────────────────────────
  const [smokeDraft,    setSmokeDraft]    = useState<string | null>(null);
  const [alcoholDraft,  setAlcoholDraft]  = useState<string | null>(null);
  const [exerciseDraft, setExerciseDraft] = useState<string | null>(null);

  // ── Symptoms draft ────────────────────────────────────────────────────────
  const [symptomsDraft, setSymptomsDraft] = useState("");
  const [symptomsFocused, setSymptomsFocused] = useState(false);

  // ── List edit copies (initialized on startEdit) ───────────────────────────
  const [editAllergies,        setEditAllergies]        = useState<AllergyItem[]>([]);
  const [editMedications,      setEditMedications]      = useState<MedicationItem[]>([]);
  const [editMedHistory,       setEditMedHistory]       = useState<MedHistoryItem[]>([]);
  const [editSurgery,          setEditSurgery]          = useState<SurgeryItem[]>([]);
  const [editFamilyHistory,    setEditFamilyHistory]    = useState<FamilyHistoryItem[]>([]);
  const [editHospitalizations, setEditHospitalizations] = useState<HospitalizationItem[]>([]);
  const [editSocialHistory,    setEditSocialHistory]    = useState<SocialHistoryItem[]>([]);

  // ── Add form (single generic Record — reset on every startEdit) ───────────
  const [addForm, setAddForm] = useState<Record<string, string>>({});
  const setField = (key: string, val: string) => setAddForm((f) => ({ ...f, [key]: val }));
  const f = (key: string) => addForm[key] ?? "";

  // ── Load ──────────────────────────────────────────────────────────────────
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
          // Not authenticated or network error
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Edit helpers ──────────────────────────────────────────────────────────
  function startEdit(section: MedSection) {
    setSaveError(null);
    setAddForm({});
    switch (section) {
      case "lifestyle":
        setSmokeDraft(profile?.smoking_status ?? null);
        setAlcoholDraft(profile?.alcohol_use ?? null);
        setExerciseDraft(profile?.exercise_level ?? null);
        break;
      case "symptoms":
        setSymptomsDraft(profile?.current_symptoms ?? "");
        break;
      case "allergies":        setEditAllergies(safeList<AllergyItem>(profile?.allergies)); break;
      case "medications":      setEditMedications(safeList<MedicationItem>(profile?.medications)); break;
      case "medHistory":       setEditMedHistory(safeList<MedHistoryItem>(profile?.medical_history)); break;
      case "surgery":          setEditSurgery(safeList<SurgeryItem>(profile?.surgical_history)); break;
      case "familyHistory":    setEditFamilyHistory(safeList<FamilyHistoryItem>(profile?.family_history)); break;
      case "hospitalizations": setEditHospitalizations(safeList<HospitalizationItem>(profile?.hospitalizations)); break;
      case "socialHistory":    setEditSocialHistory(safeList<SocialHistoryItem>(profile?.social_history)); break;
    }
    setEditingSection(section);
  }

  function cancelEdit() {
    setSaveError(null);
    setEditingSection(null);
  }

  async function persist(patch: Parameters<typeof upsertProfile>[1]) {
    setSaveError(null);
    setSaving(true);
    try {
      const userId = await getCurrentUserId();
      const updated = await upsertProfile(userId, patch);
      setProfile(updated);
      setEditingSection(null);
    } catch (e: any) {
      setSaveError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Lifestyle ─────────────────────────────────────────────────────────────
  const saveLifestyle = () => persist({
    smoking_status: smokeDraft,
    alcohol_use: alcoholDraft,
    exercise_level: exerciseDraft,
  });

  // ─── Symptoms ──────────────────────────────────────────────────────────────
  const saveSymptoms = () => persist({ current_symptoms: symptomsDraft.trim() || null });

  // ─── Allergies ─────────────────────────────────────────────────────────────
  function addAllergy() {
    if (!f("allergen").trim()) return;
    setEditAllergies((prev) => [...prev, { id: makeId(), allergen: f("allergen").trim(), reaction: f("reaction").trim(), severity: f("severity") }]);
    setAddForm({});
  }
  const saveAllergies = () => persist({ allergies: editAllergies });

  // ─── Medications ───────────────────────────────────────────────────────────
  function addMedication() {
    if (!f("name").trim()) return;
    setEditMedications((prev) => [...prev, { id: makeId(), name: f("name").trim(), dose: f("dose").trim(), frequency: f("frequency").trim() }]);
    setAddForm({});
  }
  const saveMedications = () => persist({ medications: editMedications });

  // ─── Medical history ───────────────────────────────────────────────────────
  function addMedHistory() {
    if (!f("condition").trim()) return;
    setEditMedHistory((prev) => [...prev, { id: makeId(), condition: f("condition").trim(), year: f("year").trim(), notes: f("notes").trim() }]);
    setAddForm({});
  }
  const saveMedHistory = () => persist({ medical_history: editMedHistory });

  // ─── Surgical history ──────────────────────────────────────────────────────
  function addSurgery() {
    if (!f("procedure").trim()) return;
    setEditSurgery((prev) => [...prev, { id: makeId(), procedure: f("procedure").trim(), year: f("year").trim(), notes: f("notes").trim() }]);
    setAddForm({});
  }
  const saveSurgery = () => persist({ surgical_history: editSurgery });

  // ─── Family history ────────────────────────────────────────────────────────
  function addFamilyHistory() {
    if (!f("condition").trim() || !f("relation").trim()) return;
    setEditFamilyHistory((prev) => [...prev, { id: makeId(), condition: f("condition").trim(), relation: f("relation"), notes: f("notes").trim() }]);
    setAddForm({});
  }
  const saveFamilyHistory = () => persist({ family_history: editFamilyHistory });

  // ─── Hospitalizations ──────────────────────────────────────────────────────
  function addHospitalization() {
    if (!f("reason").trim()) return;
    setEditHospitalizations((prev) => [...prev, { id: makeId(), reason: f("reason").trim(), year: f("year").trim(), notes: f("notes").trim() }]);
    setAddForm({});
  }
  const saveHospitalizations = () => persist({ hospitalizations: editHospitalizations });

  // ─── Social history ────────────────────────────────────────────────────────
  function addSocialHistory() {
    if (!f("category").trim() || !f("detail").trim()) return;
    setEditSocialHistory((prev) => [...prev, { id: makeId(), category: f("category").trim(), detail: f("detail").trim() }]);
    setAddForm({});
  }
  const saveSocialHistory = () => persist({ social_history: editSocialHistory });

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" />
        </View>
      </Screen>
    );
  }

  const editing = editingSection;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ════════════════════════════════════════════════════
              LIFESTYLE
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="🏃" title="Lifestyle"
            editing={editing === "lifestyle"}
            onEdit={() => startEdit("lifestyle")}
            onCancel={cancelEdit}
            onSave={saveLifestyle}
            saving={saving}
            error={editing === "lifestyle" ? saveError : null}
          >
            {editing === "lifestyle" ? (
              <View style={styles.formFields}>
                <View style={styles.pillGroup}>
                  <AppText variant="label">Smoking status</AppText>
                  <OptionPills options={SMOKING_OPTS} selected={smokeDraft} onSelect={setSmokeDraft} />
                </View>
                <View style={styles.pillGroup}>
                  <AppText variant="label">Alcohol use</AppText>
                  <OptionPills options={ALCOHOL_OPTS} selected={alcoholDraft} onSelect={setAlcoholDraft} />
                </View>
                <View style={styles.pillGroup}>
                  <AppText variant="label">Exercise level</AppText>
                  <OptionPills options={EXERCISE_OPTS} selected={exerciseDraft} onSelect={setExerciseDraft} />
                </View>
              </View>
            ) : (
              <View>
                <DataRow label="Smoking"  value={profile?.smoking_status} />
                <ListDivider />
                <DataRow label="Alcohol"  value={profile?.alcohol_use} />
                <ListDivider />
                <DataRow label="Exercise" value={profile?.exercise_level} />
              </View>
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              CURRENT SYMPTOMS
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="📝" title="Current Symptoms"
            editing={editing === "symptoms"}
            onEdit={() => startEdit("symptoms")}
            onCancel={cancelEdit}
            onSave={saveSymptoms}
            saving={saving}
            error={editing === "symptoms" ? saveError : null}
          >
            {editing === "symptoms" ? (
              <View style={styles.textAreaContainer}>
                <AppText variant="label">Symptoms or concerns</AppText>
                <View style={[styles.textAreaWrap, symptomsFocused && styles.textAreaFocused]}>
                  <TextInput
                    value={symptomsDraft}
                    onChangeText={setSymptomsDraft}
                    placeholder="Briefly describe any current issues, recent changes, or upcoming concerns…"
                    placeholderTextColor={colors.subtle}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    style={styles.textAreaInput}
                    onFocus={() => setSymptomsFocused(true)}
                    onBlur={() => setSymptomsFocused(false)}
                  />
                </View>
              </View>
            ) : (
              <AppText style={[styles.symptomsText, !profile?.current_symptoms && styles.symptomsEmpty]}>
                {profile?.current_symptoms || "Nothing noted yet."}
              </AppText>
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              ALLERGIES
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="⚠️" title="Allergies"
            editing={editing === "allergies"}
            onEdit={() => startEdit("allergies")}
            onCancel={cancelEdit}
            onSave={saveAllergies}
            saving={saving}
            error={editing === "allergies" ? saveError : null}
          >
            {editing === "allergies" ? (
              <View style={styles.listEditWrap}>
                {editAllergies.length === 0
                  ? <EmptyHint text="No allergies added." />
                  : editAllergies.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.allergen}
                        secondary={joinParts(item.reaction, item.severity)}
                        onDelete={() => setEditAllergies((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Allergen *" placeholder="e.g. Penicillin, Peanuts" value={f("allergen")} onChangeText={(v) => setField("allergen", v)} autoCapitalize="words" />
                  <TextField label="Reaction" placeholder="e.g. Hives, Anaphylaxis" value={f("reaction")} onChangeText={(v) => setField("reaction", v)} autoCapitalize="words" />
                  <View style={styles.pillGroup}>
                    <AppText variant="label">Severity</AppText>
                    <OptionPills options={SEVERITY_OPTS} selected={f("severity") || null} onSelect={(v) => setField("severity", v)} />
                  </View>
                  <AddButton label="Add allergy" onPress={addAllergy} />
                </View>
              </View>
            ) : (
              safeList<AllergyItem>(profile?.allergies).length === 0
                ? <EmptyHint text="No allergies recorded." />
                : safeList<AllergyItem>(profile?.allergies).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.allergen} secondary={joinParts(item.reaction, item.severity)} />
                  </View>
                ))
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              MEDICATIONS
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="💊" title="Medications"
            editing={editing === "medications"}
            onEdit={() => startEdit("medications")}
            onCancel={cancelEdit}
            onSave={saveMedications}
            saving={saving}
            error={editing === "medications" ? saveError : null}
          >
            {editing === "medications" ? (
              <View style={styles.listEditWrap}>
                {editMedications.length === 0
                  ? <EmptyHint text="No medications added." />
                  : editMedications.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.name}
                        secondary={joinParts(item.dose, item.frequency)}
                        onDelete={() => setEditMedications((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Name *" placeholder="e.g. Lisinopril" value={f("name")} onChangeText={(v) => setField("name", v)} autoCapitalize="words" />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Dose" placeholder="e.g. 10mg" value={f("dose")} onChangeText={(v) => setField("dose", v)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField label="Frequency" placeholder="e.g. Daily" value={f("frequency")} onChangeText={(v) => setField("frequency", v)} autoCapitalize="words" />
                    </View>
                  </View>
                  <AddButton label="Add medication" onPress={addMedication} />
                </View>
              </View>
            ) : (
              safeList<MedicationItem>(profile?.medications).length === 0
                ? <EmptyHint text="No medications recorded." />
                : safeList<MedicationItem>(profile?.medications).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.name} secondary={joinParts(item.dose, item.frequency)} />
                  </View>
                ))
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              MEDICAL HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="🏥" title="Medical History"
            editing={editing === "medHistory"}
            onEdit={() => startEdit("medHistory")}
            onCancel={cancelEdit}
            onSave={saveMedHistory}
            saving={saving}
            error={editing === "medHistory" ? saveError : null}
          >
            {editing === "medHistory" ? (
              <View style={styles.listEditWrap}>
                {editMedHistory.length === 0
                  ? <EmptyHint text="No conditions added." />
                  : editMedHistory.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.condition}
                        secondary={joinParts(item.year ? `Diagnosed ${item.year}` : null, item.notes)}
                        onDelete={() => setEditMedHistory((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Condition *" placeholder="e.g. Hypertension, Type 2 Diabetes" value={f("condition")} onChangeText={(v) => setField("condition", v)} autoCapitalize="words" />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Year diagnosed" placeholder="e.g. 2018" value={f("year")} onChangeText={(v) => setField("year", v)} keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 2 }}>
                      <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" />
                    </View>
                  </View>
                  <AddButton label="Add condition" onPress={addMedHistory} />
                </View>
              </View>
            ) : (
              safeList<MedHistoryItem>(profile?.medical_history).length === 0
                ? <EmptyHint text="No medical history recorded." />
                : safeList<MedHistoryItem>(profile?.medical_history).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.condition} secondary={joinParts(item.year ? `Diagnosed ${item.year}` : null, item.notes)} />
                  </View>
                ))
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              SURGICAL HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="🩹" title="Surgical History"
            editing={editing === "surgery"}
            onEdit={() => startEdit("surgery")}
            onCancel={cancelEdit}
            onSave={saveSurgery}
            saving={saving}
            error={editing === "surgery" ? saveError : null}
          >
            {editing === "surgery" ? (
              <View style={styles.listEditWrap}>
                {editSurgery.length === 0
                  ? <EmptyHint text="No surgeries added." />
                  : editSurgery.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.procedure}
                        secondary={joinParts(item.year, item.notes)}
                        onDelete={() => setEditSurgery((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Procedure *" placeholder="e.g. Appendectomy" value={f("procedure")} onChangeText={(v) => setField("procedure", v)} autoCapitalize="words" />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Year" placeholder="e.g. 2020" value={f("year")} onChangeText={(v) => setField("year", v)} keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 2 }}>
                      <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" />
                    </View>
                  </View>
                  <AddButton label="Add surgery" onPress={addSurgery} />
                </View>
              </View>
            ) : (
              safeList<SurgeryItem>(profile?.surgical_history).length === 0
                ? <EmptyHint text="No surgical history recorded." />
                : safeList<SurgeryItem>(profile?.surgical_history).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.procedure} secondary={joinParts(item.year, item.notes)} />
                  </View>
                ))
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              FAMILY HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="👨‍👩‍👧" title="Family History"
            editing={editing === "familyHistory"}
            onEdit={() => startEdit("familyHistory")}
            onCancel={cancelEdit}
            onSave={saveFamilyHistory}
            saving={saving}
            error={editing === "familyHistory" ? saveError : null}
          >
            {editing === "familyHistory" ? (
              <View style={styles.listEditWrap}>
                {editFamilyHistory.length === 0
                  ? <EmptyHint text="No family history added." />
                  : editFamilyHistory.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.condition}
                        secondary={joinParts(item.relation, item.notes)}
                        onDelete={() => setEditFamilyHistory((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Condition *" placeholder="e.g. Heart disease, Cancer" value={f("condition")} onChangeText={(v) => setField("condition", v)} autoCapitalize="words" />
                  <View style={styles.pillGroup}>
                    <AppText variant="label">Relation *</AppText>
                    <OptionPills options={RELATION_OPTS} selected={f("relation") || null} onSelect={(v) => setField("relation", v)} />
                  </View>
                  <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" />
                  <AddButton label="Add family history" onPress={addFamilyHistory} />
                </View>
              </View>
            ) : (
              safeList<FamilyHistoryItem>(profile?.family_history).length === 0
                ? <EmptyHint text="No family history recorded." />
                : safeList<FamilyHistoryItem>(profile?.family_history).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.condition} secondary={joinParts(item.relation, item.notes)} />
                  </View>
                ))
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              HOSPITALIZATIONS
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="🏨" title="Hospitalizations"
            editing={editing === "hospitalizations"}
            onEdit={() => startEdit("hospitalizations")}
            onCancel={cancelEdit}
            onSave={saveHospitalizations}
            saving={saving}
            error={editing === "hospitalizations" ? saveError : null}
          >
            {editing === "hospitalizations" ? (
              <View style={styles.listEditWrap}>
                {editHospitalizations.length === 0
                  ? <EmptyHint text="No hospitalizations added." />
                  : editHospitalizations.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.reason}
                        secondary={joinParts(item.year, item.notes)}
                        onDelete={() => setEditHospitalizations((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Reason *" placeholder="e.g. Pneumonia, Hip fracture" value={f("reason")} onChangeText={(v) => setField("reason", v)} autoCapitalize="words" />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Year" placeholder="e.g. 2021" value={f("year")} onChangeText={(v) => setField("year", v)} keyboardType="number-pad" />
                    </View>
                    <View style={{ flex: 2 }}>
                      <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" />
                    </View>
                  </View>
                  <AddButton label="Add hospitalization" onPress={addHospitalization} />
                </View>
              </View>
            ) : (
              safeList<HospitalizationItem>(profile?.hospitalizations).length === 0
                ? <EmptyHint text="No hospitalizations recorded." />
                : safeList<HospitalizationItem>(profile?.hospitalizations).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.reason} secondary={joinParts(item.year, item.notes)} />
                  </View>
                ))
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              SOCIAL HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon="🌿" title="Social History"
            editing={editing === "socialHistory"}
            onEdit={() => startEdit("socialHistory")}
            onCancel={cancelEdit}
            onSave={saveSocialHistory}
            saving={saving}
            error={editing === "socialHistory" ? saveError : null}
          >
            {editing === "socialHistory" ? (
              <View style={styles.listEditWrap}>
                {editSocialHistory.length === 0
                  ? <EmptyHint text="No social history added." />
                  : editSocialHistory.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow
                        primary={item.category}
                        secondary={item.detail}
                        onDelete={() => setEditSocialHistory((p) => p.filter((x) => x.id !== item.id))}
                      />
                    </View>
                  ))
                }
                <View style={styles.addFormDivider} />
                <View style={styles.formFields}>
                  <TextField label="Category *" placeholder="e.g. Tobacco, Living situation" value={f("category")} onChangeText={(v) => setField("category", v)} autoCapitalize="words" />
                  <TextField label="Detail *" placeholder="e.g. Smoked 10 years, quit 2012" value={f("detail")} onChangeText={(v) => setField("detail", v)} autoCapitalize="sentences" />
                  <AddButton label="Add entry" onPress={addSocialHistory} />
                </View>
              </View>
            ) : (
              safeList<SocialHistoryItem>(profile?.social_history).length === 0
                ? <EmptyHint text="No social history recorded." />
                : safeList<SocialHistoryItem>(profile?.social_history).map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <ListDivider />}
                    <ItemRow primary={item.category} secondary={item.detail} />
                  </View>
                ))
            )}
          </SectionCard>

          <AppText style={styles.footerNote}>
            This information is stored privately and only used to generate your personal health documents.
          </AppText>

        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: {
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.md,
    paddingTop: spacing.md,
  },

  // ── Forms ──
  formFields: { gap: spacing.md },
  inlineRow: { flexDirection: "row", gap: spacing.sm },
  pillGroup: { gap: spacing.xs },

  // ── List edit ──
  listEditWrap: { gap: 0 },
  addFormDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
    marginHorizontal: -spacing.lg,
  },

  // ── Text area (symptoms) ──
  textAreaContainer: { gap: spacing.xs },
  textAreaWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 100,
  },
  textAreaFocused: {
    borderColor: colors.teal,
    borderWidth: 1.5,
    shadowColor: colors.teal,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  textAreaInput: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium as any,
    color: colors.text,
    minHeight: 80,
  },
  symptomsText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium as any,
    color: colors.text,
    paddingVertical: spacing.xs,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
  },
  symptomsEmpty: { color: colors.subtle, fontWeight: typescale.weight.regular as any },

  // ── Footer ──
  footerNote: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: colors.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xs,
  },
});
