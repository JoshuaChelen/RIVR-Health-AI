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
import { colors, spacing, radius, typescale } from "../../theme/tokens";

export function ManageDocumentsScreen() {
  const [refreshKey, setRefreshKey]     = useState(0);
  const [starting, setStarting]         = useState(false);
  const [msg, setMsg]                   = useState<string | null>(null);
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

      const { error: jobErr } = await supabase.functions.invoke(
        "enqueue-document-processing",
        { headers: { Authorization: `Bearer ${token}` }, body: { documentIds: ids } }
      );

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
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="h1">Documents</AppText>
          <AppText variant="muted" style={styles.headerSub}>
            Upload PDFs or voice notes, then process when ready.
          </AppText>
        </View>

        <View
          style={[
            styles.badge,
            pendingCount > 0 ? styles.badgeActive : styles.badgeIdle,
          ]}
        >
          <AppText
            variant="label"
            style={{ color: pendingCount > 0 ? colors.teal : colors.subtle }}
          >
            {pendingCount} pending
          </AppText>
        </View>
      </View>

      {/* List */}
      <View style={styles.list}>
        <ListDocuments
          refreshKey={refreshKey}
          onPendingCountChange={setPendingCount}
          header={
            <>
              <RecordVoiceNote onUploaded={() => setRefreshKey((k) => k + 1)} />
              <UploadFile onUploaded={() => setRefreshKey((k) => k + 1)} />
            </>
          }
        />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Card style={styles.footerCard}>
          {msg ? (
            <AppText variant="caption" style={styles.msg}>{msg}</AppText>
          ) : null}

          <PrimaryButton
            label={
              starting
                ? "Starting…"
                : pendingCount > 0
                ? `Process ${pendingCount} file${pendingCount === 1 ? "" : "s"}`
                : "Process documents"
            }
            onPress={startProcessing}
            disabled={starting || pendingCount === 0}
            tone="teal"
            style={{ width: "100%" }}
          />

          {pendingCount === 0 ? (
            <AppText variant="caption" style={styles.noFiles}>
              No files waiting to process.
            </AppText>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerSub: {
    marginTop: 3,
  },

  badge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeActive: {
    backgroundColor: colors.tealSoft,
    borderColor: colors.tealBorder,
  },
  badgeIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },

  list: { flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  footerCard: { gap: spacing.sm, padding: spacing.md },

  msg: {
    color: colors.textSub,
  },
  noFiles: {
    marginTop: 6,
    textAlign: "center",
    color: colors.subtle,
  },
});
