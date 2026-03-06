import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../../lib/supabase";

import { AppText } from "../../components/ui/Primitives/AppText";
import { Card } from "../../components/ui/Primitives/Card";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { GhostButton } from "../../components/ui/Primitives/GhostButton";
import {
  ShareFileType,
  ShareFormatToggle,
} from "../../components/ui/ShareScreen/ShareFormatToggle";
import { SelectableDocRow } from "../../components/ui/ShareScreen/SelectableDocRow";

import { colors, spacing, radius, shadows, typescale } from "../../theme/tokens";

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
};

export function ShareScreen() {
  const [docs, setDocs]               = useState<DocRow[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [fileType, setFileType]       = useState<ShareFileType>("card");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError]   = useState<string | null>(null);
  const [shareUrl, setShareUrl]       = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("User not authenticated"); return; }

      const { data, error } = await supabase
        .from("documents")
        .select("id,title,created_at,status")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      else setDocs((data ?? []) as DocRow[]);
    })();
  }, []);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

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
        fileType === "pdf"  ? "pdf"  :
        "summary";

      const { data: pkg, error } = await supabase.functions.invoke("create-share-package", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          documentIds: selectedIds,
          fileType: apiFileType,
          expiresInMinutes: 1,
          maxViews: 2,
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
    if (shareUrl) await Clipboard.setStringAsync(shareUrl);
  };

  return (
    <View style={styles.container}>
      <AppText variant="h1" style={styles.title}>Share Records</AppText>
      <AppText variant="muted" style={styles.subtitle}>
        Select documents and choose a format to generate a secure link.
      </AppText>

      <ShareFormatToggle value={fileType} onChange={setFileType} />

      {error ? (
        <AppText variant="caption" style={{ color: colors.danger }}>{error}</AppText>
      ) : null}

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingBottom: 12 }}
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <AppText variant="muted">No documents yet. Upload files first.</AppText>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.docCard}>
            <SelectableDocRow
              title={item.title ?? "(untitled)"}
              subtitle={`${item.status ?? "unknown"} · ${new Date(item.created_at).toLocaleDateString()}`}
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

      {/* Share modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <AppText variant="h2">Secure Share Link</AppText>
            <GhostButton label="Close" onPress={() => setModalVisible(false)} />
          </View>

          {shareLoading ? (
            <View style={styles.modalCenter}>
              <ActivityIndicator color={colors.teal} />
              <AppText variant="muted" style={{ marginTop: 12 }}>
                Creating your secure package…
              </AppText>
            </View>
          ) : shareError ? (
            <View style={styles.modalCenter}>
              <AppText variant="caption" style={{ color: colors.danger, textAlign: "center" }}>
                {shareError}
              </AppText>
            </View>
          ) : shareUrl ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              {/* QR code */}
              <View style={styles.qrWrap}>
                <QRCode value={shareUrl} size={200} />
              </View>

              {/* URL */}
              <View style={styles.urlBox}>
                <AppText variant="caption" style={styles.urlText} numberOfLines={2}>
                  {shareUrl}
                </AppText>
              </View>

              <AppText variant="caption" style={styles.expireNote}>
                This link expires in 1 minute and can be viewed up to 2 times.
              </AppText>

              <PrimaryButton label="Copy link" onPress={copyToClipboard} />
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  title: {
    marginBottom: 0,
  },
  subtitle: {
    marginTop: 2,
  },

  docCard: {
    padding: 0,
    overflow: "hidden",
  },

  emptyList: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },

  bottom: {
    paddingTop: spacing.xs,
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  modalContent: {
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: "center",
  },

  qrWrap: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
    marginBottom: spacing.sm,
  },
  urlBox: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    width: "100%",
  },
  urlText: {
    color: colors.textSub,
    textAlign: "center",
  },
  expireNote: {
    color: colors.subtle,
    textAlign: "center",
  },
});
