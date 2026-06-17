import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { getProfile, upsertProfile, manualProfileSignature, type UserProfile } from "../../lib/profile";
import { upsertManualInputDocument } from "../../lib/documents";
import { getCurrentUserId } from "../../lib/auth";
import {
  listDocuments, enqueueDocumentProcessing,
  confirmAiItem, rejectAiItem, getAiItemSources,
} from "../../lib/api/data";
import {
  makeId, safeList, joinParts,
  type AllergyItem, type MedicationItem, type MedHistoryItem,
  type SurgeryItem, type FamilyHistoryItem,
  type HospitalizationItem, type SocialHistoryItem,
} from "../../lib/profileMedical";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { TextField } from "../../components/ui/Primitives/TextField";
import { OptionPills } from "../../components/ui/Onboarding/OptionPills";
import { SectionCard } from "../../components/ui/Profile/SectionCard";
import { DataRow } from "../../components/ui/Profile/DataRow";
import Ionicons from "@expo/vector-icons/Ionicons";

import { captureException } from "../../lib/sentry";
import { radius, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";

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

const useSubStyles = createStyles((c) => StyleSheet.create({
  // ── ItemRow ──
  irRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, gap: spacing.sm },
  irText: { flex: 1, gap: 2 },
  irPrimary: { fontSize: typescale.size.base, fontWeight: typescale.weight.medium as any, color: c.text },
  irSecondary: { fontSize: typescale.size.xs, color: c.muted },
  irDel: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.dangerSoft },
  // ── ListDivider ──
  divider: { height: 1, backgroundColor: c.borderLight },
  // ── EmptyHint ──
  ehWrap: { paddingVertical: spacing.md, alignItems: "center" },
  ehText: { fontSize: typescale.size.sm, fontStyle: "italic", color: c.subtle },
  // ── AddButton ──
  abBtn: { paddingVertical: spacing.xs, paddingHorizontal: 2, alignSelf: "flex-start" },
  abText: { fontSize: typescale.size.sm, fontWeight: typescale.weight.semibold as any, color: c.teal },
  // ── AiItemControls ──
  aiMeta: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
  aiChip: { backgroundColor: c.tealSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  aiChipText: { fontSize: typescale.size.xs, fontWeight: typescale.weight.semibold as any, color: c.teal },
  aiDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.teal },
  aiActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs, flexWrap: "wrap" },
  aiAction: { backgroundColor: c.tealSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  aiActionText: { fontSize: typescale.size.xs, fontWeight: typescale.weight.semibold as any, color: c.teal },
  aiReject: { backgroundColor: c.dangerSoft },
  aiRejectText: { color: c.danger },
}));

function ItemRow({ primary, secondary, onDelete }: {
  primary: string; secondary?: string; onDelete?: () => void;
}) {
  const s = useSubStyles();
  const { colors } = useTheme();
  return (
    <View style={s.irRow}>
      <View style={s.irText}>
        <AppText style={s.irPrimary}>{primary}</AppText>
        {secondary ? <AppText style={s.irSecondary}>{secondary}</AppText> : null}
      </View>
      {onDelete ? (
        <Pressable accessible accessibilityRole="button" accessibilityLabel="Remove item" onPress={onDelete} style={({ pressed }) => [s.irDel, pressed && { opacity: 0.6 }]} hitSlop={8}>
          <Ionicons name="close" size={12} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

// AI badge + inline review actions for an ai_-id profile item. `reviewStatus`
// is the server-owned per-item state; when unset the item still needs review.
function AiItemControls({ itemId, reviewStatus, onReviewed }: {
  itemId: string;
  reviewStatus?: string;
  onReviewed: () => void;
}) {
  const s = useSubStyles();
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setBusy(true);
    try {
      await confirmAiItem(itemId);
      onReviewed();
    } catch (e) {
      captureException(e);
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    setBusy(true);
    try {
      await rejectAiItem(itemId);
      onReviewed();
    } catch (e) {
      captureException(e);
    } finally {
      setBusy(false);
    }
  }

  async function onSource() {
    try {
      const { sources } = await getAiItemSources(itemId);
      const titles = sources.map((src) => src.title).join(", ");
      Alert.alert("Source documents", titles || "No source documents found.");
    } catch (e) {
      captureException(e);
    }
  }

  return (
    <View>
      <View style={s.aiMeta}>
        <View style={s.aiChip}>
          <AppText style={s.aiChipText}>AI</AppText>
        </View>
        {!reviewStatus ? <View style={s.aiDot} /> : null}
      </View>
      <View style={s.aiActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Confirm AI item" disabled={busy} onPress={onConfirm} style={({ pressed }) => [s.aiAction, pressed && { opacity: 0.6 }]}>
          <AppText style={s.aiActionText}>Confirm</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Reject AI item" disabled={busy} onPress={onReject} style={({ pressed }) => [s.aiAction, s.aiReject, pressed && { opacity: 0.6 }]}>
          <AppText style={[s.aiActionText, s.aiRejectText]}>Reject</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Show source documents" onPress={onSource} style={({ pressed }) => [s.aiAction, pressed && { opacity: 0.6 }]}>
          <AppText style={s.aiActionText}>Source</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function ListDivider() {
  const s = useSubStyles();
  return <View style={s.divider} />;
}

function EmptyHint({ text }: { text: string }) {
  const s = useSubStyles();
  return (
    <View style={s.ehWrap}>
      <AppText style={s.ehText}>{text}</AppText>
    </View>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useSubStyles();
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.abBtn, pressed && { opacity: 0.7 }]}
    >
      <AppText style={s.abText}>+ {label}</AppText>
    </Pressable>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function MedicalProfileScreen({ navigation }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
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
  const loadProfile = useCallback(async () => {
    try {
      const userId = await getCurrentUserId();
      const p = await getProfile(userId);
      setProfile(p);
    } catch (e) {
      captureException(e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const userId = await getCurrentUserId();
          if (!active) return;
          const p = await getProfile(userId);
          if (active) setProfile(p);
        } catch (e) {
          captureException(e);
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
    const beforeSig = manualProfileSignature(profile);

    const updated = await upsertProfile(userId, patch);
    const afterSig = manualProfileSignature(updated);

    setProfile(updated);
    setEditingSection(null);

    if (beforeSig !== afterSig) {
      try {
        await upsertManualInputDocument(userId);
      } catch (e) {
        captureException(e);
      }
    }
  } catch (e: any) {
    captureException(e);
    setSaveError(e?.message ?? "Save failed.");
  } finally {
    setSaving(false);
  }
}


const didHandleExitRef = useRef(false);

const enqueueManualProfileIfPending = useCallback(async () => {
  const userId = await getCurrentUserId();
  if (!userId) return;

  // Query documents to find the manual input document with status 'uploaded'
  const { results } = await listDocuments();
  const manualDoc = results.find(
    (doc) => doc.source_type === "manual_input" && doc.status === "uploaded"
  );

  if (!manualDoc?.id) return;

  // Enqueue the manual document for processing
  await enqueueDocumentProcessing([manualDoc.id]);
}, []);

useFocusEffect(
  useCallback(() => {
    didHandleExitRef.current = false;
    return undefined;
  }, [])
);

useEffect(() => {
  const unsub = navigation.addListener("beforeRemove", (e) => {
    if (didHandleExitRef.current) return;

    e.preventDefault();
    didHandleExitRef.current = true;

    const action = e.data.action;

    (async () => {
      try {
        await enqueueManualProfileIfPending();
      } catch (e) {
        captureException(e);
      } finally {
        navigation.dispatch(action);
      }
    })();
  });

  return unsub;
}, [navigation, enqueueManualProfileIfPending]);

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
  function saveAllergies() {
    // Auto-commit any valid in-progress form entry. This also closes the
    // stale-closure race: if Save fires before the Add state update commits,
    // addForm still holds the form data and we include it here.
    const pending = f("allergen").trim();
    const list = pending
      ? [...editAllergies, { id: makeId(), allergen: pending, reaction: f("reaction").trim(), severity: f("severity") }]
      : editAllergies;
    persist({ allergies: list });
  }

  // ─── Medications ───────────────────────────────────────────────────────────
  function addMedication() {
    if (!f("name").trim()) return;
    setEditMedications((prev) => [...prev, { id: makeId(), name: f("name").trim(), dose: f("dose").trim(), frequency: f("frequency").trim() }]);
    setAddForm({});
  }
  function saveMedications() {
    const pending = f("name").trim();
    const list = pending
      ? [...editMedications, { id: makeId(), name: pending, dose: f("dose").trim(), frequency: f("frequency").trim() }]
      : editMedications;
    persist({ medications: list });
  }

  // ─── Medical history ───────────────────────────────────────────────────────
  function addMedHistory() {
    if (!f("condition").trim()) return;
    setEditMedHistory((prev) => [...prev, { id: makeId(), condition: f("condition").trim(), year: f("year").trim(), notes: f("notes").trim() }]);
    setAddForm({});
  }
  function saveMedHistory() {
    const pending = f("condition").trim();
    const list = pending
      ? [...editMedHistory, { id: makeId(), condition: pending, year: f("year").trim(), notes: f("notes").trim() }]
      : editMedHistory;
    persist({ medical_history: list });
  }

  // ─── Surgical history ──────────────────────────────────────────────────────
  function addSurgery() {
    if (!f("procedure").trim()) return;
    setEditSurgery((prev) => [...prev, { id: makeId(), procedure: f("procedure").trim(), year: f("year").trim(), notes: f("notes").trim() }]);
    setAddForm({});
  }
  function saveSurgery() {
    const pending = f("procedure").trim();
    const list = pending
      ? [...editSurgery, { id: makeId(), procedure: pending, year: f("year").trim(), notes: f("notes").trim() }]
      : editSurgery;
    persist({ surgical_history: list });
  }

  // ─── Family history ────────────────────────────────────────────────────────
  function addFamilyHistory() {
    if (!f("condition").trim() || !f("relation").trim()) return;
    setEditFamilyHistory((prev) => [...prev, { id: makeId(), condition: f("condition").trim(), relation: f("relation"), notes: f("notes").trim() }]);
    setAddForm({});
  }
  function saveFamilyHistory() {
    // Both condition and relation are required for a valid family history entry.
    const pendingCondition = f("condition").trim();
    const pendingRelation  = f("relation").trim();
    const list = (pendingCondition && pendingRelation)
      ? [...editFamilyHistory, { id: makeId(), condition: pendingCondition, relation: pendingRelation, notes: f("notes").trim() }]
      : editFamilyHistory;
    persist({ family_history: list });
  }

  // ─── Hospitalizations ──────────────────────────────────────────────────────
  function addHospitalization() {
    if (!f("reason").trim()) return;
    setEditHospitalizations((prev) => [...prev, { id: makeId(), reason: f("reason").trim(), year: f("year").trim(), notes: f("notes").trim() }]);
    setAddForm({});
  }
  function saveHospitalizations() {
    const pending = f("reason").trim();
    const list = pending
      ? [...editHospitalizations, { id: makeId(), reason: pending, year: f("year").trim(), notes: f("notes").trim() }]
      : editHospitalizations;
    persist({ hospitalizations: list });
  }

  // ─── Social history ────────────────────────────────────────────────────────
  function addSocialHistory() {
    if (!f("category").trim() || !f("detail").trim()) return;
    setEditSocialHistory((prev) => [...prev, { id: makeId(), category: f("category").trim(), detail: f("detail").trim() }]);
    setAddForm({});
  }
  function saveSocialHistory() {
    // Both category and detail are required for a valid social history entry.
    const pendingCategory = f("category").trim();
    const pendingDetail   = f("detail").trim();
    const list = (pendingCategory && pendingDetail)
      ? [...editSocialHistory, { id: makeId(), category: pendingCategory, detail: pendingDetail }]
      : editSocialHistory;
    persist({ social_history: list });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Screen edges={["left", "right", "bottom"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" accessibilityLabel="Loading medical profile" />
        </View>
      </Screen>
    );
  }

  const editing = editingSection;

  return (
    <Screen edges={["left", "right", "bottom"]}>
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
             icon={<Ionicons name="walk-outline" size={18} color={colors.teal} />} title="Lifestyle"
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
            icon={<Ionicons name="create-outline" size={18} color={colors.teal} />} title="Current Symptoms"
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
                    showSoftInputOnFocus
                    maxLength={2000}
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
            icon={<Ionicons name="warning-outline" size={18} color={colors.teal} />} title="Allergies"
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
                  <TextField label="Allergen *" placeholder="e.g. Penicillin, Peanuts" value={f("allergen")} onChangeText={(v) => setField("allergen", v)} autoCapitalize="words" maxLength={200} />
                  <TextField label="Reaction" placeholder="e.g. Hives, Anaphylaxis" value={f("reaction")} onChangeText={(v) => setField("reaction", v)} autoCapitalize="words" maxLength={200} />
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
                : safeList<AllergyItem>(profile?.allergies).map((item, i) => {
                  const isAi = typeof item.id === "string" && item.id.startsWith("ai_");
                  return (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow primary={item.allergen} secondary={joinParts(item.reaction, item.severity)} />
                      {isAi ? (
                        <AiItemControls itemId={item.id} reviewStatus={(item as any).review_status} onReviewed={loadProfile} />
                      ) : null}
                    </View>
                  );
                })
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              MEDICATIONS
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon={<Ionicons name="medical-outline" size={18} color={colors.teal} />} title="Medications"
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
                  <TextField label="Name *" placeholder="e.g. Lisinopril" value={f("name")} onChangeText={(v) => setField("name", v)} autoCapitalize="words" maxLength={200} />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Dose" placeholder="e.g. 10mg" value={f("dose")} onChangeText={(v) => setField("dose", v)} maxLength={100} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField label="Frequency" placeholder="e.g. Daily" value={f("frequency")} onChangeText={(v) => setField("frequency", v)} autoCapitalize="words" maxLength={100} />
                    </View>
                  </View>
                  <AddButton label="Add medication" onPress={addMedication} />
                </View>
              </View>
            ) : (
              safeList<MedicationItem>(profile?.medications).length === 0
                ? <EmptyHint text="No medications recorded." />
                : safeList<MedicationItem>(profile?.medications).map((item, i) => {
                  const isAi = typeof item.id === "string" && item.id.startsWith("ai_");
                  return (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow primary={item.name} secondary={joinParts(item.dose, item.frequency)} />
                      {isAi ? (
                        <AiItemControls itemId={item.id} reviewStatus={(item as any).review_status} onReviewed={loadProfile} />
                      ) : null}
                    </View>
                  );
                })
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              MEDICAL HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon={<Ionicons name="pulse-outline" size={18} color={colors.teal} />} title="Medical History"
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
                  <TextField label="Condition *" placeholder="e.g. Hypertension, Type 2 Diabetes" value={f("condition")} onChangeText={(v) => setField("condition", v)} autoCapitalize="words" maxLength={200} />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Year diagnosed" placeholder="e.g. 2018" value={f("year")} onChangeText={(v) => setField("year", v)} keyboardType="number-pad" maxLength={4} />
                    </View>
                    <View style={{ flex: 2 }}>
                      <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" maxLength={500} />
                    </View>
                  </View>
                  <AddButton label="Add condition" onPress={addMedHistory} />
                </View>
              </View>
            ) : (
              safeList<MedHistoryItem>(profile?.medical_history).length === 0
                ? <EmptyHint text="No medical history recorded." />
                : safeList<MedHistoryItem>(profile?.medical_history).map((item, i) => {
                  const isAi = typeof item.id === "string" && item.id.startsWith("ai_");
                  return (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow primary={item.condition} secondary={joinParts(item.year ? `Diagnosed ${item.year}` : null, item.notes)} />
                      {isAi ? (
                        <AiItemControls itemId={item.id} reviewStatus={(item as any).review_status} onReviewed={loadProfile} />
                      ) : null}
                    </View>
                  );
                })
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              SURGICAL HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon={<Ionicons name="bandage-outline" size={18} color={colors.teal} />} title="Surgical History"
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
                  <TextField label="Procedure *" placeholder="e.g. Appendectomy" value={f("procedure")} onChangeText={(v) => setField("procedure", v)} autoCapitalize="words" maxLength={200} />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Year" placeholder="e.g. 2020" value={f("year")} onChangeText={(v) => setField("year", v)} keyboardType="number-pad" maxLength={4} />
                    </View>
                    <View style={{ flex: 2 }}>
                      <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" maxLength={500} />
                    </View>
                  </View>
                  <AddButton label="Add surgery" onPress={addSurgery} />
                </View>
              </View>
            ) : (
              safeList<SurgeryItem>(profile?.surgical_history).length === 0
                ? <EmptyHint text="No surgical history recorded." />
                : safeList<SurgeryItem>(profile?.surgical_history).map((item, i) => {
                  const isAi = typeof item.id === "string" && item.id.startsWith("ai_");
                  return (
                    <View key={item.id}>
                      {i > 0 && <ListDivider />}
                      <ItemRow primary={item.procedure} secondary={joinParts(item.year, item.notes)} />
                      {isAi ? (
                        <AiItemControls itemId={item.id} reviewStatus={(item as any).review_status} onReviewed={loadProfile} />
                      ) : null}
                    </View>
                  );
                })
            )}
          </SectionCard>

          {/* ════════════════════════════════════════════════════
              FAMILY HISTORY
          ════════════════════════════════════════════════════ */}
          <SectionCard
            icon={<Ionicons name="people-outline" size={18} color={colors.teal} />} title="Family History"
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
                  <TextField label="Condition *" placeholder="e.g. Heart disease, Cancer" value={f("condition")} onChangeText={(v) => setField("condition", v)} autoCapitalize="words" maxLength={200} />
                  <View style={styles.pillGroup}>
                    <AppText variant="label">Relation *</AppText>
                    <OptionPills options={RELATION_OPTS} selected={f("relation") || null} onSelect={(v) => setField("relation", v)} />
                  </View>
                  <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" maxLength={500} />
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
            icon={<Ionicons name="business-outline" size={18} color={colors.teal} />} title="Hospitalizations"
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
                  <TextField label="Reason *" placeholder="e.g. Pneumonia, Hip fracture" value={f("reason")} onChangeText={(v) => setField("reason", v)} autoCapitalize="words" maxLength={200} />
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Year" placeholder="e.g. 2021" value={f("year")} onChangeText={(v) => setField("year", v)} keyboardType="number-pad" maxLength={4} />
                    </View>
                    <View style={{ flex: 2 }}>
                      <TextField label="Notes" placeholder="Optional" value={f("notes")} onChangeText={(v) => setField("notes", v)} autoCapitalize="sentences" maxLength={500} />
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
            icon={<Ionicons name="leaf-outline" size={18} color={colors.teal} />} title="Social History"
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
                  <TextField label="Category *" placeholder="e.g. Tobacco, Living situation" value={f("category")} onChangeText={(v) => setField("category", v)} autoCapitalize="words" maxLength={200} />
                  <TextField label="Detail *" placeholder="e.g. Smoked 10 years, quit 2012" value={f("detail")} onChangeText={(v) => setField("detail", v)} autoCapitalize="sentences" maxLength={500} />
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

const useStyles = createStyles((colors) => StyleSheet.create({
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
}));
