import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../../lib/supabase";

// Primitives
import { AppText } from "../../components/ui/Primitives/AppText";
import { Card } from "../../components/ui/Primitives/Card";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";

// UI Components
import {
  ShareFileType,
  ShareFormatToggle,
} from "../../components/ui/ShareScreen/ShareFormatToggle";
import { SelectableDocRow } from "../../components/ui/ShareScreen/SelectableDocRow";
import { ShareItemCard } from "../../components/ui/ShareScreen/ShareItemCard";

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
};

type DocPathsRow = {
  id: string;
  title: string | null;
  fhir_path: string | null;
  summary_path: string | null;
};

export function ShareScreen() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<ShareFileType>("card");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  
  // NEW: Single share URL instead of a map of urls
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Updated Fetching Logic with User Filter
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError("User not authenticated");
        return;
      }

      const { data, error } = await supabase
        .from("documents")
        .select("id,title,created_at,status")
        .eq("user_id", user.id) // Filter by current user
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      else setDocs((data ?? []) as DocRow[]);
    })();
  }, []);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // NEW: Refactored Share Logic using Edge Function
  const handleCreateShare = async () => {
  setModalVisible(true);
  setShareLoading(true);
  setShareError(null);
  setShareUrl(null);

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");

    const apiFileType: "summary" | "pdf" | "fhir" =
  fileType === "fhir" ? "fhir" :
  fileType === "pdf" ? "pdf" :
  "summary";

    const { data: pkg, error } = await supabase.functions.invoke("create-share-package", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: {
        documentIds: selectedIds,
        fileType: apiFileType,
        expiresInMinutes: 1,
        maxViews: 2,
        // pin: "1234", // optional
      },
    });

    if (error) throw error;
    if (pkg?.shareUrl) setShareUrl(pkg.shareUrl);
    else throw new Error("No shareUrl returned");
  } catch (e: any) {
    setShareError(e?.message ?? "Failed to create share link.");
  } finally {
    setShareLoading(false);
  }
};


  const copyToClipboard = async () => {
    if (shareUrl) {
      await Clipboard.setStringAsync(shareUrl);
      // Optional: Add a "Copied!" toast here
    }
  };

  return (
    <View style={styles.container}>
      <AppText variant="h1">Share</AppText>

      <ShareFormatToggle value={fileType} onChange={setFileType} />

      {error ? <AppText style={{ color: "red" }}>{error}</AppText> : null}

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderItem={({ item }) => (
          <Card>
            <SelectableDocRow
              title={item.title ?? "(untitled)"}
              subtitle={`${item.status ?? "unknown"} • ${new Date(item.created_at).toLocaleDateString()}`}
              selected={selectedIds.includes(item.id)}
              onToggle={() => toggleSelected(item.id)}
            />
          </Card>
        )}
      />

      <View style={styles.bottom}>
        <PrimaryButton
          label={
            selectedIds.length > 0
              ? `Share ${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"}`
              : "Select at least 1 document"
          }
          onPress={handleCreateShare}
          disabled={selectedIds.length === 0}
        />
      </View>

      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <AppText variant="title">Share Link</AppText>
            <PrimaryButton label="Close" onPress={() => setModalVisible(false)} style={{ width: 80 }} />
          </View>

          {shareLoading ? (
            <View style={styles.centerContent}>
              <AppText>Creating your secure package...</AppText>
            </View>
          ) : shareError ? (
            <AppText style={{ color: "red" }}>{shareError}</AppText>
          ) : (
            <View style={styles.centerContent}>
              {shareUrl ? (
                <>
                  <Card style={styles.qrCard}>
                    <QRCode value={shareUrl} size={180} />
                  </Card>
                  
                  <AppText style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
                    {shareUrl}
                  </AppText>

                  <PrimaryButton 
                    label="Copy link" 
                    onPress={copyToClipboard} 
                    style={{ marginTop: 20, width: '100%' }} 
                  />
                </>
              ) : null}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  bottom: { paddingTop: 6 },
  modalContainer: { flex: 1, padding: 24, gap: 12 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1
  },
  qrCard: {
    padding: 20,
    backgroundColor: 'white',
    marginBottom: 20
  },
  urlText: {
    marginTop: 10,
    color: '#666',
    fontSize: 14
  }
});