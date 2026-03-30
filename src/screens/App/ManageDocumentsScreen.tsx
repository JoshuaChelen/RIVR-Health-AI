import React, { useEffect, useLayoutEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";

import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";
import { RecordVoiceNote } from "../../components/ui/ManageDocuments/RecordVoiceNote";
import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";

type Props = NativeStackScreenProps<AppStackParamList, "ManageDocuments">;

export function ManageDocumentsScreen({ navigation }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  const [refreshKey, setRefreshKey]     = useState(0);
  const [starting, setStarting]         = useState(false);
  const [msg, setMsg]                   = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  // Sync pending badge into the native navigation header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
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
      ),
    });
  }, [navigation, pendingCount, styles, colors]);

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
        setMsg("No pending items. Upload a file or save a change in Medical Profile first.");
        return;
      }

      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      for (const id of ids) {
        const { error: jobErr } = await supabase.functions.invoke(
          "enqueue-document-processing",
          {
            headers: { Authorization: `Bearer ${token}` },
            body: { documentIds: [id] },
          }
        );

        if (jobErr) throw jobErr;
      }

      setMsg(`Started processing ${ids.length} item(s).`);

      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to start processing.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen edges={["left", "right", "bottom"]} style={styles.screen}>
      {/* List */}
      <View style={styles.list}>
        <ListDocuments
          refreshKey={refreshKey}
          onPendingCountChange={setPendingCount}
          header={
            <>
              <UploadFile onUploaded={() => setRefreshKey((k) => k + 1)} />
              <RecordVoiceNote onUploaded={() => setRefreshKey((k) => k + 1)} />
            </>
          }
        />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {msg ? (
          <AppText variant="caption" style={styles.msg}>{msg}</AppText>
        ) : null}

        <PrimaryButton
          label={
            starting
              ? "Starting…"
              : pendingCount > 0
              ? `Process ${pendingCount} item${pendingCount === 1 ? "" : "s"}`
              : "Nothing to process"
          }
          onPress={startProcessing}
          disabled={starting || pendingCount === 0}
          tone="teal"
          style={styles.processBtn}
        />

        {pendingCount === 0 && !msg ? (
          <AppText variant="caption" style={styles.noFiles}>
            Upload files or save a change in Medical Profile, then tap Process.
          </AppText>
        ) : pendingCount > 0 ? (
          <AppText variant="caption" style={styles.readyHint}>
            {pendingCount} item{pendingCount === 1 ? "" : "s"} ready — tap Process to analyze.
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  screen: { flex: 1 },

  badge: {
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      radius.pill,
    borderWidth:       StyleSheet.hairlineWidth,
  },
  badgeActive: {
    backgroundColor: c.tealSoft,
    borderColor:     c.tealBorder,
  },
  badgeIdle: {
    backgroundColor: "transparent",
    borderColor:     c.border,
  },

  list: { flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bg,
    gap: spacing.xs,
  },
  processBtn: {
    width: "100%",
    shadowColor: c.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  msg: {
    textAlign: "center",
    color: c.teal,
    fontWeight: typescale.weight.medium,
  },
  noFiles: {
    textAlign: "center",
    color: c.muted,
    paddingHorizontal: spacing.md,
  },
  readyHint: {
    textAlign: "center",
    color: c.teal,
    fontWeight: typescale.weight.medium,
  },
}));
