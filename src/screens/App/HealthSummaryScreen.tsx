import React, { useEffect, useRef, useState, useCallback } from "react";
import { ActivityIndicator, ScrollView, View, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";

import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { GhostButton } from "../../components/ui/Primitives/GhostButton";

import { supabase } from "../../lib/supabase";
import {
  getAllDocumentIds,
  getHealthProfile,
  getLatestJob,
  getLatestEvaluation,
  startAiJob,
} from "../../lib/aiJobs";

import { colors, spacing, radius, typescale } from "../../theme/tokens";

import { Share as RNShare } from "react-native";

function safeJoin(arr: any[]) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "";
}

function format3x5Text(input: { score?: number | null; label?: string | null; card: any }) {
  const { score, label, card } = input;
  const lines: string[] = [];
  if (typeof score === "number") lines.push(`Shin Score: ${score}/100${label ? ` (${label})` : ""}`);
  lines.push("");
  lines.push("3x5 Essentials");
  lines.push(`Blood type: ${card?.blood_type ?? "Unknown"}`);
  lines.push(`Major conditions: ${safeJoin(card?.major_conditions) || "None listed"}`);
  lines.push(`Major surgeries: ${safeJoin(card?.major_surgeries) || "None listed"}`);
  lines.push(`Current meds: ${safeJoin(card?.current_meds) || "None listed"}`);
  lines.push(`Allergies: ${safeJoin(card?.allergies) || "None listed"}`);
  lines.push(`Implants/devices: ${safeJoin(card?.implants_devices) || "None listed"}`);
  lines.push(`Anticoagulants: ${safeJoin(card?.anticoagulants) || "None listed"}`);
  lines.push(`Anesthesia notes: ${safeJoin(card?.anesthesia_notes) || "None listed"}`);
  const ec = card?.emergency_contact;
  if (ec?.name || ec?.phone) lines.push(`Emergency contact: ${ec?.name ?? ""} ${ec?.phone ?? ""}`.trim());
  if (card?.one_line_summary) { lines.push(""); lines.push(`Summary: ${String(card.one_line_summary)}`); }
  return lines.join("\n");
}

function formatFullSummaryText(input: {
  score?: number | null;
  label?: string | null;
  overview?: string | null;
  full?: string | null;
  disclaimer?: string | null;
}) {
  const lines: string[] = [];
  if (typeof input.score === "number") lines.push(`Shin Score: ${input.score}/100${input.label ? ` (${input.label})` : ""}`);
  if (input.overview) { lines.push(""); lines.push(String(input.overview)); }
  if (input.full)     { lines.push(""); lines.push(String(input.full)); }
  if (input.disclaimer) { lines.push(""); lines.push(String(input.disclaimer)); }
  return lines.join("\n");
}

export default function HealthSummaryScreen() {
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [job, setJob]           = useState<any>(null);
  const [profile, setProfile]   = useState<any>(null);
  const [evaluation, setEval]   = useState<any>(null);
  const [error, setError]       = useState<string | null>(null);
  const pollRef                 = useRef<any>(null);

  const load = useCallback(async () => {
    setError(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }

    try {
      const [j, p, ev] = await Promise.all([
        getLatestJob(userRes.user.id),
        getHealthProfile(userRes.user.id),
        getLatestEvaluation(userRes.user.id),
      ]);
      setJob(j);
      setProfile(p);
      setEval(ev?.result ?? null);
      setRunning(!!(j && (j.status === "queued" || j.status === "running")));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  async function start() {
    setError(null);
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) { setError("Not signed in."); return; }

    try {
      setRunning(true);
      const docIds = await getAllDocumentIds(user.id);
      if (docIds.length === 0) {
        setError("Upload at least one document first.");
        setRunning(false);
        return;
      }
      await startAiJob(docIds);
      await load();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(load, 2000);
    } catch (e: any) {
      setError(String(e?.message || e));
      setRunning(false);
    }
  }

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  useEffect(() => {
    const isRunning = job && (job.status === "queued" || job.status === "running");
    if (!isRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setRunning(false);
    }
  }, [job?.status]);

  const score    = profile?.score ?? evaluation?.score_0_to_100;
  const label    = profile?.score_label ?? evaluation?.score_label;
  const overview = profile?.summary_json?.overview ?? evaluation?.overview ?? null;
  const disclaimer = profile?.summary_json?.disclaimer ?? evaluation?.disclaimer ?? null;
  const fullSummary = profile?.summary_json?.full_summary_markdown ?? evaluation?.full_summary_markdown ?? null;
  const card     = profile?.card_json ?? evaluation?.three_by_five_card ?? null;

  const onShareCard = async () => {
    if (!card) return;
    await RNShare.share({ message: format3x5Text({ score, label, card }) });
  };
  const onCopyCard = async () => {
    if (!card) return;
    await Clipboard.setStringAsync(format3x5Text({ score, label, card }));
  };
  const onShareFull = async () => {
    await RNShare.share({ message: formatFullSummaryText({ score, label, overview, full: fullSummary, disclaimer }) });
  };
  const onCopyFull = async () => {
    await Clipboard.setStringAsync(formatFullSummaryText({ score, label, overview, full: fullSummary, disclaimer }));
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <AppText variant="h1" style={styles.pageTitle}>Health Summary</AppText>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : null}

        {error ? (
          <Card>
            <AppText variant="caption" style={{ color: colors.danger }}>{error}</AppText>
          </Card>
        ) : null}

        {/* Status card */}
        <Card style={styles.statusCard}>
          <AppText variant="label" style={styles.sectionLabel}>AI Job Status</AppText>
          <AppText variant="title" style={styles.statusValue}>
            {job?.status ? String(job.status) : "No job yet"}
          </AppText>

          {job?.error ? (
            <AppText variant="caption" style={{ color: colors.danger, marginTop: 6 }}>
              {String(job.error)}
            </AppText>
          ) : null}

          <View style={styles.statusActions}>
            <PrimaryButton
              label={running ? "Running…" : "Generate / Refresh"}
              onPress={start}
              disabled={running}
              style={{ flex: 1 }}
            />
            <GhostButton label="Reload" onPress={load} />
          </View>
        </Card>

        {(profile || evaluation) ? (
          <>
            {/* Score card */}
            <Card style={styles.scoreCard}>
              <AppText variant="label" style={styles.sectionLabel}>Shin Score</AppText>
              <View style={styles.scoreRow}>
                <AppText style={styles.scoreValue}>
                  {typeof score === "number" ? score : "—"}
                </AppText>
                <AppText variant="muted" style={styles.scoreMax}>/100</AppText>
                {label ? (
                  <View style={styles.scoreBadge}>
                    <AppText variant="label" style={{ color: colors.teal }}>{label}</AppText>
                  </View>
                ) : null}
              </View>
              {overview ? (
                <AppText variant="body" style={styles.overview}>{String(overview)}</AppText>
              ) : null}
            </Card>

            {/* 3x5 card */}
            <Card>
              <AppText variant="h2" style={styles.cardTitle}>3×5 Essentials</AppText>

              {card ? (
                <>
                  <View style={styles.essentialsList}>
                    <EssentialRow label="Blood type" value={card?.blood_type ?? "Unknown"} />
                    <EssentialRow label="Allergies"  value={safeJoin(card?.allergies) || "None listed"} />
                    <EssentialRow label="Medications" value={safeJoin(card?.current_meds) || "None listed"} />
                    <EssentialRow label="Conditions" value={safeJoin(card?.major_conditions) || "None listed"} />
                  </View>

                  <View style={styles.cardActions}>
                    <PrimaryButton label="Share 3×5 card" onPress={onShareCard} style={{ flex: 1 }} />
                    <GhostButton  label="Copy text"        onPress={onCopyCard} />
                  </View>
                </>
              ) : (
                <AppText variant="muted" style={{ marginTop: 8 }}>
                  No card yet — generate the summary first.
                </AppText>
              )}

              {disclaimer ? (
                <AppText variant="caption" style={styles.disclaimer}>{String(disclaimer)}</AppText>
              ) : null}
            </Card>

            {/* Full summary */}
            <Card>
              <AppText variant="h2" style={styles.cardTitle}>Full Summary</AppText>

              {fullSummary ? (
                <>
                  <AppText variant="mono" style={styles.fullText}>{String(fullSummary)}</AppText>
                  <View style={styles.cardActions}>
                    <PrimaryButton label="Share summary" onPress={onShareFull} style={{ flex: 1 }} />
                    <GhostButton  label="Copy text"       onPress={onCopyFull} />
                  </View>
                </>
              ) : (
                <AppText variant="muted" style={{ marginTop: 8 }}>
                  No summary yet — generate one first.
                </AppText>
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function EssentialRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={essStyles.row}>
      <AppText variant="label" style={essStyles.label}>{label}</AppText>
      <AppText variant="body"  style={essStyles.value}>{value}</AppText>
    </View>
  );
}

const essStyles = StyleSheet.create({
  row: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 2,
  },
  label: { color: colors.muted, marginBottom: 1 },
  value: { color: colors.text },
});

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  pageTitle: {
    marginBottom: spacing.xs,
  },
  center: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },

  statusCard: {
    gap: spacing.sm,
  },
  sectionLabel: {
    marginBottom: 2,
  },
  statusValue: {
    color: colors.text,
  },
  statusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 4,
  },

  scoreCard: {
    gap: spacing.xs,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: 4,
  },
  scoreValue: {
    fontSize: typescale.size.hero + 4,
    fontWeight: typescale.weight.black,
    color: colors.text,
    lineHeight: (typescale.size.hero + 4) * 1.1,
  },
  scoreMax: {
    fontSize: typescale.size.lg,
    color: colors.subtle,
  },
  scoreBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 4,
  },
  overview: {
    marginTop: spacing.sm,
    color: colors.textSub,
  },

  cardTitle: {
    marginBottom: spacing.sm,
  },
  essentialsList: {
    gap: 0,
    marginBottom: spacing.md,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  fullText: {
    color: colors.textSub,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  disclaimer: {
    marginTop: spacing.md,
    color: colors.subtle,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
});
