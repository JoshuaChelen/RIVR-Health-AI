import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { Card } from "../../components/ui/Primitives/Card";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";

import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";
import { RecordVoiceNote } from "../../components/ui/ManageDocuments/RecordVoiceNote";
import { colors } from "../../theme/tokens";

export function ManageDocumentsScreen() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  async function loadPendingCount() {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) return;

    const { data, error } = await supabase
      .from("documents")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "uploaded");

    if (!error) setPendingCount((data ?? []).length);
  }

  useEffect(() => {
    loadPendingCount();
  }, [refreshKey]);

  const startProcessing = async () => {
    setMsg(null);
    setStarting(true);

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error("Not signed in");

      const { data: pending, error } = await supabase
        .from("documents")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "uploaded")
        .order("created_at", { ascending: true });

      if (error) throw error;

      const ids = (pending ?? []).map((r: any) => String(r.id));
      if (ids.length === 0) {
        setMsg("No pending uploads. Upload files first.");
        return;
      }

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const { error: jobErr } = await supabase.functions.invoke("enqueue-document-processing", {
        headers: { Authorization: `Bearer ${token}` },
        body: { documentIds: ids },
      });

      if (jobErr) throw jobErr;

      setMsg(`Started processing ${ids.length} file(s).`);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to start processing.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <AppText variant="h1">Manage Documents</AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            Upload PDFs or voice notes, then start processing when ready.
          </AppText>
        </View>

        <View
          style={[
            styles.pendingBadge,
            pendingCount > 0 ? styles.pendingBadgeActive : styles.pendingBadgeIdle,
          ]}
        >
          <AppText
            variant="caption"
            style={{ fontWeight: "800", color: pendingCount > 0 ? colors.teal : colors.muted }}
          >
            {pendingCount} pending
          </AppText>
        </View>
      </View>

      <View style={styles.content}>
        <RecordVoiceNote onUploaded={() => setRefreshKey((k) => k + 1)} />
        <UploadFile onUploaded={() => setRefreshKey((k) => k + 1)} />

        <View style={{ flex: 1, minHeight: 140 }}>
          <ListDocuments refreshKey={refreshKey} />
        </View>
      </View>

      <View style={styles.footer}>
        <Card style={styles.footerCard}>
          {msg ? <AppText variant="caption">{msg}</AppText> : null}

          <PrimaryButton
            label={
              starting
                ? "Starting..."
                : pendingCount > 0
                ? `Start processing (${pendingCount})`
                : "Start processing"
            }
            onPress={startProcessing}
            disabled={starting || pendingCount === 0}
            tone="teal"
            style={{ width: "100%" }}
          />

          {pendingCount === 0 ? (
            <AppText variant="caption" style={{ marginTop: 8, color: colors.subtle }}>
              No pending uploads right now.
            </AppText>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  pendingBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pendingBadgeActive: {
    backgroundColor: colors.tealSoft,
    borderColor: "rgba(44,185,176,0.25)",
  },
  pendingBadgeIdle: {
    backgroundColor: "#fff",
    borderColor: colors.border,
  },

  content: { flex: 1, paddingHorizontal: 16, gap: 12 },

  footer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  footerCard: { gap: 10, padding: 14 },
});