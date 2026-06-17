import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Linking, Alert, StyleSheet, TextInput } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { AppText } from "../../components/ui/Primitives/AppText";
import { BottomSheet } from "../../components/ui/Primitives/BottomSheet";
import { useTheme } from "../../context/ThemeContext";
import { createStyles } from "../../theme/createStyles";
import { spacing, radius, typescale } from "../../theme/tokens";
import {
  getDocumentAnalysis, getDocumentFile, detachDocument, reprocessDocument,
  confirmAiItem, rejectAiItem, editAiItem, unrejectAiItem, confirmAllDocument,
} from "../../lib/api/data";
import { badgeForState, isActionable, type ContributionState } from "../../lib/documentReview";

type Props = NativeStackScreenProps<AppStackParamList, "DocumentDetail">;
type Contribution = {
  field: string; key?: string; label: string; fact: Record<string, any>;
  current?: Record<string, any> | null;
  origin: "ai" | "manual"; state: ContributionState; profile_item_id: string | null;
  ai_original: Record<string, any> | null;
};

const FIELD_TITLES: Record<string, string> = {
  allergies: "Allergies", medications: "Medications",
  medical_history: "Conditions", surgical_history: "Surgeries & procedures",
};

// Editable detail fields per array field — MUST match the backend DETAIL_FIELDS
// in apps/profiles/ai_item_views.py (the key field is intentionally not editable).
const EDITABLE: Record<string, { key: string; label: string }[]> = {
  allergies: [{ key: "reaction", label: "Reaction" }, { key: "severity", label: "Severity" }],
  medications: [{ key: "dose", label: "Dose" }, { key: "frequency", label: "Frequency" }],
  medical_history: [{ key: "year", label: "Year" }, { key: "notes", label: "Notes" }],
  surgical_history: [{ key: "year", label: "Year" }, { key: "notes", label: "Notes" }],
};

export function DocumentDetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { colors } = useTheme();
  const s = useStyles();
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editing, setEditing] = useState<Contribution | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAnalysis(await getDocumentAnalysis(id)); }
    catch (e: any) { setError(e?.message ?? "Could not load analysis."); }
    finally { setLoading(false); }
  }, [id]);

  // A data-changing review action kicks off a background re-eval of the summary +
  // emergency card. Flag it briefly so the user knows the rest of their data is catching up.
  function flagUpdating() {
    setUpdating(true);
    setTimeout(() => setUpdating(false), 6000);
  }

  useEffect(() => { load(); }, [load]);

  async function openOriginal() {
    try {
      const { url } = await getDocumentFile(id);
      if (url) await Linking.openURL(url);
      else Alert.alert("Unavailable", "The original file could not be opened.");
    } catch { Alert.alert("Unavailable", "The original file could not be opened."); }
  }

  async function onConfirm(itemId: string) {
    setBusyItem(itemId);
    try { await confirmAiItem(itemId); await load(); }
    catch (e: any) { Alert.alert("Couldn't confirm", e?.message ?? "Please try again."); }
    finally { setBusyItem(null); }
  }
  async function onReject(itemId: string) {
    setBusyItem(itemId);
    try { await rejectAiItem(itemId); flagUpdating(); await load(); }
    catch (e: any) { Alert.alert("Couldn't reject", e?.message ?? "Please try again."); }
    finally { setBusyItem(null); }
  }
  async function onUnreject(c: Contribution) {
    if (!c.key) return;
    setBusyItem(c.key);
    try { await unrejectAiItem(c.field, c.key); flagUpdating(); await load(); }
    catch (e: any) { Alert.alert("Couldn't undo", e?.message ?? "Please try again."); }
    finally { setBusyItem(null); }
  }
  async function onConfirmAll() {
    if (acting) return;
    setActing(true);
    try { await confirmAllDocument(id); await load(); }
    catch (e: any) { Alert.alert("Couldn't confirm all", e?.message ?? "Please try again."); }
    finally { setActing(false); }
  }
  function openEdit(c: Contribution) {
    const src = c.current ?? c.fact ?? {};
    const init: Record<string, string> = {};
    for (const f of EDITABLE[c.field] ?? []) init[f.key] = String(src[f.key] ?? "");
    setEditValues(init);
    setEditing(c);
  }
  async function saveEdit() {
    const c = editing;
    if (!c?.profile_item_id) { setEditing(null); return; }
    setBusyItem(c.profile_item_id);
    setEditing(null);
    try { await editAiItem(c.profile_item_id, editValues); flagUpdating(); await load(); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message ?? "Please try again."); }
    finally { setBusyItem(null); }
  }
  async function onDetach() {
    setConfirmDetach(false);
    setActing(true);
    try { await detachDocument(id); await load(); }
    catch (e: any) { Alert.alert("Couldn't cancel results", e?.message ?? "Please try again."); }
    finally { setActing(false); }
  }
  async function onReprocess() {
    if (acting) return;
    setActing(true);
    try { await reprocessDocument(id); navigation.goBack(); }
    catch (e: any) { setActing(false); Alert.alert("Couldn't re-run", e?.message ?? "Please try again."); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;
  if (error) return <View style={s.center}><AppText style={s.error}>{error}</AppText></View>;

  const confidence = analysis?.confidence_0_to_1;
  const detached = analysis?.detached === true;
  const contribs: Contribution[] = analysis?.contributions ?? [];
  const grouped: Record<string, Contribution[]> = {};
  for (const c of contribs) (grouped[c.field] ??= []).push(c);

  return (
    <ScrollView contentContainerStyle={s.container}>
      {detached ? (
        <View style={s.detachedBox}>
          <AppText style={s.detachedText}>
            Results removed from your profile. Re-run the analysis to restore them.
          </AppText>
        </View>
      ) : null}

      {updating ? (
        <View style={s.updatingBox}>
          <ActivityIndicator color={colors.teal} size="small" />
          <AppText style={s.updatingText}>Updating your summary & emergency card…</AppText>
        </View>
      ) : null}

      <Pressable style={s.openBtn} onPress={openOriginal} accessibilityRole="button">
        <AppText style={s.openBtnText}>View original file</AppText>
      </Pressable>

      {typeof confidence === "number" ? (
        <View style={s.confidenceBox}>
          <AppText style={s.confidenceLabel}>AI confidence: {Math.round(confidence * 100)}%</AppText>
          <AppText style={s.confidenceHint}>Self-reported by the AI — verify against the original.</AppText>
        </View>
      ) : null}

      {contribs.some((c) => c.origin === "ai" && c.state === "unreviewed") ? (
        <Pressable style={[s.confirmAll, acting && s.disabled]} disabled={acting}
          onPress={onConfirmAll} accessibilityRole="button">
          <AppText style={s.confirmAllText}>Looks right — confirm all</AppText>
        </Pressable>
      ) : null}

      {Object.keys(FIELD_TITLES).map((field) => {
        const items = grouped[field];
        if (!items?.length) return null;
        return (
          <View key={field} style={s.section}>
            <AppText style={s.sectionTitle}>{FIELD_TITLES[field]}</AppText>
            {items.map((c, i) => {
              const badge = badgeForState(c.state, c.origin);
              const actionable = isActionable(c.state, c.origin) && !!c.profile_item_id;
              const itemBusy = busyItem === c.profile_item_id;
              return (
                <View key={`${field}-${i}`} style={s.itemCard}>
                  <View style={s.itemHead}>
                    <AppText style={s.itemLabel}>{c.label}</AppText>
                    <View style={[s.badge, { backgroundColor: toneBg(colors, badge.tone) }]}>
                      <AppText style={[s.badgeText, { color: toneFg(colors, badge.tone) }]}>{badge.label}</AppText>
                    </View>
                  </View>
                  {c.ai_original ? (
                    <AppText style={s.original}>AI originally read: {summarize(c.ai_original)}</AppText>
                  ) : null}
                  {actionable ? (
                    <View style={s.actions}>
                      {c.state !== "confirmed" ? (
                        <Pressable disabled={itemBusy} onPress={() => onConfirm(c.profile_item_id!)} style={s.actionConfirm}>
                          <AppText style={s.actionConfirmText}>Confirm</AppText>
                        </Pressable>
                      ) : null}
                      <Pressable disabled={itemBusy} onPress={() => openEdit(c)} style={s.actionEdit}>
                        <AppText style={s.actionEditText}>Edit</AppText>
                      </Pressable>
                      <Pressable disabled={itemBusy} onPress={() => onReject(c.profile_item_id!)} style={s.actionReject}>
                        <AppText style={s.actionRejectText}>Reject</AppText>
                      </Pressable>
                    </View>
                  ) : null}
                  {c.state === "rejected" ? (
                    <View style={s.actions}>
                      <Pressable disabled={busyItem === c.key} onPress={() => onUnreject(c)} style={s.actionConfirm}>
                        <AppText style={s.actionConfirmText}>Undo rejection</AppText>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={s.footer}>
        <Pressable style={[s.rerun, acting && s.disabled]} disabled={acting} onPress={onReprocess} accessibilityRole="button">
          <AppText style={s.rerunText}>{acting ? "Working…" : "Re-run analysis"}</AppText>
        </Pressable>
        <Pressable style={[s.cancel, acting && s.disabled]} disabled={acting} onPress={() => setConfirmDetach(true)} accessibilityRole="button">
          <AppText style={s.cancelText}>Cancel results</AppText>
        </Pressable>
      </View>

      {confirmDetach ? (
        <BottomSheet visible accent="teal" title="Cancel this document's results?"
          message="Findings this document added to your profile will be removed (shared findings are kept). The file stays in your library, and you can re-run it later."
          onClose={() => setConfirmDetach(false)}>
          <View style={s.sheetRow}>
            <Pressable style={s.sheetSecondary} onPress={() => setConfirmDetach(false)}>
              <AppText style={s.sheetSecondaryText}>Keep</AppText>
            </Pressable>
            <Pressable style={s.sheetPrimary} onPress={onDetach}>
              <AppText style={s.sheetPrimaryText}>Remove results</AppText>
            </Pressable>
          </View>
        </BottomSheet>
      ) : null}

      {editing ? (
        <BottomSheet visible accent="teal" title={`Edit ${editing.label}`}
          message="Correct what the AI recorded. The original AI value is kept for reference."
          onClose={() => setEditing(null)}>
          <View style={s.editForm}>
            {(EDITABLE[editing.field] ?? []).map((f) => (
              <View key={f.key} style={s.editRow}>
                <AppText style={s.editLabel}>{f.label}</AppText>
                <TextInput
                  style={s.editInput}
                  value={editValues[f.key] ?? ""}
                  onChangeText={(t) => setEditValues((v) => ({ ...v, [f.key]: t }))}
                  placeholder={f.label}
                  placeholderTextColor={colors.muted}
                />
              </View>
            ))}
            <View style={s.sheetRow}>
              <Pressable style={s.sheetSecondary} onPress={() => setEditing(null)}>
                <AppText style={s.sheetSecondaryText}>Cancel</AppText>
              </Pressable>
              <Pressable style={s.sheetPrimary} onPress={saveEdit}>
                <AppText style={s.sheetPrimaryText}>Save</AppText>
              </Pressable>
            </View>
          </View>
        </BottomSheet>
      ) : null}
    </ScrollView>
  );
}

// Render an item's value dict as a readable line (e.g. {dose:"500mg"} -> "500mg").
function summarize(obj: Record<string, any>): string {
  return Object.entries(obj)
    .filter(([k, v]) => k !== "id" && v != null && String(v).trim() !== "")
    .map(([, v]) => String(v))
    .join(" · ") || "—";
}

function toneBg(c: any, t: string) {
  return t === "ok" ? c.tealSoft : t === "warn" ? c.dangerSoft : t === "neutral" ? c.warnSoft : c.bgSecondary;
}
function toneFg(c: any, t: string) {
  return t === "ok" ? c.teal : t === "warn" ? c.danger : t === "neutral" ? c.warning : c.muted;
}

const useStyles = createStyles((c) => StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: c.danger },
  detachedBox: { backgroundColor: c.warnSoft, borderRadius: radius.md, padding: spacing.md },
  detachedText: { color: c.warning, fontSize: typescale.size.sm, fontWeight: typescale.weight.medium },
  updatingBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.tealSoft,
    borderRadius: radius.md, padding: spacing.md },
  updatingText: { color: c.teal, fontSize: typescale.size.sm, fontWeight: typescale.weight.medium },
  confirmAll: { backgroundColor: c.tealSoft, borderRadius: radius.md, padding: spacing.sm, alignItems: "center" },
  confirmAllText: { color: c.teal, fontWeight: typescale.weight.semibold, fontSize: typescale.size.sm },
  openBtn: { backgroundColor: c.tealSoft, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  openBtnText: { color: c.teal, fontWeight: typescale.weight.semibold },
  confidenceBox: { backgroundColor: c.bgSecondary, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  confidenceLabel: { color: c.text, fontWeight: typescale.weight.semibold },
  confidenceHint: { color: c.muted, fontSize: typescale.size.xs },
  section: { gap: spacing.xs },
  sectionTitle: { color: c.muted, fontWeight: typescale.weight.bold, textTransform: "uppercase",
    fontSize: typescale.size.xs, letterSpacing: 0.8 },
  itemCard: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, gap: spacing.xs },
  itemHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  itemLabel: { color: c.text, fontWeight: typescale.weight.semibold, flex: 1 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: typescale.size.xs, fontWeight: typescale.weight.semibold },
  original: { color: c.muted, fontSize: typescale.size.xs },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  actionConfirm: { backgroundColor: c.tealSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionConfirmText: { color: c.teal, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  actionEdit: { backgroundColor: c.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionEditText: { color: c.textSub, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  actionReject: { backgroundColor: c.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionRejectText: { color: c.danger, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  footer: { gap: spacing.sm, marginTop: spacing.md },
  disabled: { opacity: 0.5 },
  rerun: { backgroundColor: c.tealSoft, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  rerunText: { color: c.teal, fontWeight: typescale.weight.semibold },
  cancel: { borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: c.border },
  cancelText: { color: c.muted, fontWeight: typescale.weight.semibold },
  sheetRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  sheetSecondary: { flex: 1, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    backgroundColor: c.bgSecondary, borderWidth: 1, borderColor: c.border },
  sheetSecondaryText: { color: c.textSub, fontWeight: typescale.weight.semibold },
  sheetPrimary: { flex: 1.4, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    backgroundColor: c.teal },
  sheetPrimaryText: { color: "#fff", fontWeight: typescale.weight.bold },
  editForm: { gap: spacing.sm },
  editRow: { gap: 4 },
  editLabel: { color: c.muted, fontSize: typescale.size.xs, fontWeight: typescale.weight.semibold },
  editInput: { backgroundColor: c.bgSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: c.text, fontSize: typescale.size.sm },
}));
