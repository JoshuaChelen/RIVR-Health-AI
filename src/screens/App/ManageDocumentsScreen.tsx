// src/screens/App/ManageDocumentsScreen.tsx
import React, { useState } from "react";
import { StyleSheet } from "react-native";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { Card } from "../../components/ui/Primitives/Card";
import { SecondaryButton } from "../../components/ui/Primitives/SecondaryButton";
export function ManageDocumentsScreen() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

      setMsg(`Started processing ${ids.length} document(s).`);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to start processing.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen style={styles.container}>
      <AppText variant="h1">Documents</AppText>

      <UploadFile onUploaded={() => setRefreshKey((k) => k + 1)} />

      {/* Files list FIRST */}
      <ListDocuments refreshKey={refreshKey} />

      {/* Start button UNDER the files */}
      <Card style={{ gap: 10 }}>
        {msg ? <AppText variant="caption">{msg}</AppText> : null}
        <SecondaryButton
          label={starting ? "Starting..." : "Start processing"}
          onPress={startProcessing}
          disabled={starting}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
});