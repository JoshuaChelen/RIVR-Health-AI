import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Linking, Alert, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { AppText } from "../../components/ui/Primitives/AppText";
import { BottomSheet } from "../../components/ui/Primitives/BottomSheet";
import { useTheme } from "../../context/ThemeContext";
import { createStyles } from "../../theme/createStyles";
import { spacing, radius, typescale } from "../../theme/tokens";
import {
  getDocumentAnalysis, getDocumentFile, detachDocument, reprocessDocument,
  confirmAiItem, rejectAiItem,
} from "../../lib/api/data";
import { badgeForState, isActionable, type ContributionState } from "../../lib/documentReview";

type Props = NativeStackScreenProps<AppStackParamList, "DocumentDetail">;
type Contribution = {
  field: string; label: string; fact: Record<string, any>;
  origin: "ai" | "manual"; state: ContributionState; profile_item_id: string | null;
  ai_original: Record<string, any> | null;
};

const FIELD_TITLES: Record<string, string> = {
  allergies: "Allergies", medications: "Medications",
  medical_history: "Conditions", surgical_history: "Surgeries & procedures",
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

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAnalysis(await getDocumentAnalysis(id)); }
    catch (e: any) { setError(e?.message ?? "Could not load analysis."); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function openOriginal() {
    try {
      const { url } = await getDocumentFile(id);
      if (url) Linking.openURL(url);
      else Alert.alert("Unavailable", "The original file could not be opened.");
    } catch { Alert.alert("Unavailable", "The original file could not be opened."); }
  }

  async function onConfirm(itemId: string) {
    setBusyItem(itemId);
    try { await confirmAiItem(itemId); await load(); } finally { setBusyItem(null); }
  }
  async function onReject(itemId: string) {
    setBusyItem(itemId);
    try { await rejectAiItem(itemId); await load(); } finally { setBusyItem(null); }
  }
  async function onDetach() {
    setConfirmDetach(false);
    try { await detachDocument(id); await load(); } catch (e: any) { setError(e?.message ?? "Failed."); }
  }
  async function onReprocess() {
    try { await reprocessDocument(id); navigation.goBack(); }
    catch (e: any) { setError(e?.message ?? "Failed to re-run."); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;
  if (error) return <View style={s.center}><AppText style={s.error}>{error}</AppText></View>;

  const confidence = analysis?.confidence_0_to_1;
  const contribs: Contribution[] = analysis?.contributions ?? [];
  const grouped: Record<string, Contribution[]> = {};
  for (const c of contribs) (grouped[c.field] ??= []).push(c);

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Pressable style={s.openBtn} onPress={openOriginal} accessibilityRole="button">
        <AppText style={s.openBtnText}>View original file</AppText>
      </Pressable>

      {typeof confidence === "number" ? (
        <View style={s.confidenceBox}>
          <AppText style={s.confidenceLabel}>AI confidence: {Math.round(confidence * 100)}%</AppText>
          <AppText style={s.confidenceHint}>Self-reported by the AI — verify against the original.</AppText>
        </View>
      ) : null}

      {Object.keys(FIELD_TITLES).map((field) => {
        const items = grouped[field];
        if (!items?.length) return null;
        return (
          <View key={field} style={s.section}>
            <AppText style={s.sectionTitle}>{FIELD_TITLES[field]}</AppText>
            {items.map((c, i) => {
              const badge = badgeForState(c.state, c.origin);
              return (
                <View key={`${field}-${i}`} style={s.itemCard}>
                  <View style={s.itemHead}>
                    <AppText style={s.itemLabel}>{c.label}</AppText>
                    <View style={[s.badge, { backgroundColor: toneBg(colors, badge.tone) }]}>
                      <AppText style={[s.badgeText, { color: toneFg(colors, badge.tone) }]}>{badge.label}</AppText>
                    </View>
                  </View>
                  {c.ai_original ? (
                    <AppText style={s.original}>AI originally read: {JSON.stringify(c.ai_original)}</AppText>
                  ) : null}
                  {isActionable(c.state, c.origin) && c.profile_item_id ? (
                    <View style={s.actions}>
                      <Pressable disabled={busyItem === c.profile_item_id}
                        onPress={() => onConfirm(c.profile_item_id!)} style={s.actionConfirm}>
                        <AppText style={s.actionConfirmText}>Confirm</AppText>
                      </Pressable>
                      <Pressable disabled={busyItem === c.profile_item_id}
                        onPress={() => onReject(c.profile_item_id!)} style={s.actionReject}>
                        <AppText style={s.actionRejectText}>Reject</AppText>
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
        <Pressable style={s.rerun} onPress={onReprocess} accessibilityRole="button">
          <AppText style={s.rerunText}>Re-run analysis</AppText>
        </Pressable>
        <Pressable style={s.cancel} onPress={() => setConfirmDetach(true)} accessibilityRole="button">
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
    </ScrollView>
  );
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
  actions: { flexDirection: "row", gap: spacing.sm },
  actionConfirm: { backgroundColor: c.tealSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionConfirmText: { color: c.teal, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  actionReject: { backgroundColor: c.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionRejectText: { color: c.muted, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  footer: { gap: spacing.sm, marginTop: spacing.md },
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
}));
