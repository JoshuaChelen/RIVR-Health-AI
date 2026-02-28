// src/screens/App/HealthSummaryScreen.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { ActivityIndicator, ScrollView, View, Share as RNShare } from "react-native";
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

function safeJoin(arr: any[]) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "";
}

function format3x5Text(input: {
  score?: number | null;
  label?: string | null;
  card: any;
}) {
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
  if (ec?.name || ec?.phone) {
    lines.push(`Emergency contact: ${ec?.name ?? ""} ${ec?.phone ?? ""}`.trim());
  }

  if (card?.one_line_summary) {
    lines.push("");
    lines.push(`One-line: ${String(card.one_line_summary)}`);
  }

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
  if (input.overview) {
    lines.push("");
    lines.push(String(input.overview));
  }
  if (input.full) {
    lines.push("");
    lines.push(String(input.full));
  }
  if (input.disclaimer) {
    lines.push("");
    lines.push(String(input.disclaimer));
  }
  return lines.join("\n");
}

async function shareText(message: string) {
  await RNShare.share({ message });
}

export default function HealthSummaryScreen() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [job, setJob] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  // fallback if profile not written yet for some reason
  const [evaluation, setEvaluation] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    setError(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }

    const userId = userRes.user.id;

    try {
      const [j, p, ev] = await Promise.all([
        getLatestJob(userId),
        getHealthProfile(userId),
        getLatestEvaluation(userId),
      ]);

      setJob(j);
      setProfile(p);
      setEvaluation(ev?.result ?? null);

      const isRunning = j && (j.status === "queued" || j.status === "running");
      setRunning(!!isRunning);
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
    if (!user) {
      setError("Not signed in.");
      return;
    }

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
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  useEffect(() => {
    const isRunning = job && (job.status === "queued" || job.status === "running");
    if (!isRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setRunning(false);
    }
  }, [job?.status]);

  // prefer profile (your worker writes it). fallback to evaluation if needed
  const score = profile?.score ?? evaluation?.score_0_to_100;
  const label = profile?.score_label ?? evaluation?.score_label;

  const overview =
    profile?.summary_json?.overview ??
    evaluation?.overview ??
    null;

  const disclaimer =
    profile?.summary_json?.disclaimer ??
    evaluation?.disclaimer ??
    null;

  const fullSummary =
    profile?.summary_json?.full_summary_markdown ??
    evaluation?.full_summary_markdown ??
    null;

  const card =
    profile?.card_json ??
    evaluation?.three_by_five_card ??
    null;

  const onShareCard = async () => {
    if (!card) return;
    const text = format3x5Text({ score, label, card });
    await shareText(text);
  };

  const onCopyCard = async () => {
    if (!card) return;
    const text = format3x5Text({ score, label, card });
    await Clipboard.setStringAsync(text);
  };

  const onShareFull = async () => {
    const text = formatFullSummaryText({
      score,
      label,
      overview,
      full: fullSummary,
      disclaimer,
    });
    await shareText(text);
  };

  const onCopyFull = async () => {
    const text = formatFullSummaryText({
      score,
      label,
      overview,
      full: fullSummary,
      disclaimer,
    });
    await Clipboard.setStringAsync(text);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <AppText style={{ fontSize: 22, fontWeight: "800" }}>Health Summary</AppText>

        {loading ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator />
          </View>
        ) : null}

        {error ? (
          <Card>
            <AppText style={{ fontSize: 14 }}>{error}</AppText>
          </Card>
        ) : null}

        <Card>
          <AppText style={{ fontSize: 14, opacity: 0.8 }}>Status</AppText>
          <AppText style={{ fontSize: 16, fontWeight: "700" }}>
            {job?.status ? String(job.status) : "No job yet"}
          </AppText>

          {job?.error ? (
            <AppText style={{ marginTop: 8, fontSize: 13 }}>
              Last error: {String(job.error)}
            </AppText>
          ) : null}

          <View style={{ height: 12 }} />

          <PrimaryButton
            label={running ? "Running..." : "Generate / Refresh Summary"}
            onPress={start}
            disabled={running}
          />
          <View style={{ height: 8 }} />
          <GhostButton label="Reload" onPress={load} />
        </Card>

        {(profile || evaluation) ? (
          <>
            <Card>
              <AppText style={{ fontSize: 14, opacity: 0.8 }}>Score</AppText>
              <AppText style={{ fontSize: 28, fontWeight: "900" }}>
                {typeof score === "number" ? `${score}/100` : "N/A"} {label ? `(${label})` : ""}
              </AppText>
              {overview ? (
                <AppText style={{ marginTop: 8, fontSize: 14 }}>{String(overview)}</AppText>
              ) : null}
            </Card>

            <Card>
              <AppText style={{ fontSize: 16, fontWeight: "900" }}>3x5 Essentials</AppText>

              {card ? (
                <>
                  <AppText style={{ marginTop: 8, fontSize: 14 }}>
                    Blood type: {card?.blood_type ?? "Unknown"}
                  </AppText>

                  <AppText style={{ marginTop: 10, fontSize: 13, fontWeight: "900" }}>Allergies</AppText>
                  <AppText style={{ fontSize: 14 }}>
                    {safeJoin(card?.allergies) || "None listed"}
                  </AppText>

                  <AppText style={{ marginTop: 10, fontSize: 13, fontWeight: "900" }}>Current meds</AppText>
                  <AppText style={{ fontSize: 14 }}>
                    {safeJoin(card?.current_meds) || "None listed"}
                  </AppText>

                  <AppText style={{ marginTop: 10, fontSize: 13, fontWeight: "900" }}>Major conditions</AppText>
                  <AppText style={{ fontSize: 14 }}>
                    {safeJoin(card?.major_conditions) || "None listed"}
                  </AppText>

                  <View style={{ height: 12 }} />
                  <PrimaryButton label="Share 3x5 card" onPress={onShareCard} />
                  <View style={{ height: 8 }} />
                  <GhostButton label="Copy 3x5 text" onPress={onCopyCard} />
                </>
              ) : (
                <AppText style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
                  No 3x5 card yet. Generate the summary first.
                </AppText>
              )}

              {disclaimer ? (
                <AppText style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  {String(disclaimer)}
                </AppText>
              ) : null}
            </Card>

            <Card>
              <AppText style={{ fontSize: 16, fontWeight: "900" }}>Full summary</AppText>

              {fullSummary ? (
                <>
                  <AppText style={{ marginTop: 8, fontSize: 14 }}>
                    {String(fullSummary)}
                  </AppText>

                  <View style={{ height: 12 }} />
                  <PrimaryButton label="Share full summary" onPress={onShareFull} />
                  <View style={{ height: 8 }} />
                  <GhostButton label="Copy full summary" onPress={onCopyFull} />
                </>
              ) : (
                <AppText style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
                  No full summary yet. Generate the summary first.
                </AppText>
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
