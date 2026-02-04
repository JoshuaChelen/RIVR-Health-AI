import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { supabase } from "../../lib/supabase";
import { createSignedFileUrl } from "../../lib/storage";

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
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id,title,created_at,status")
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      else setDocs((data ?? []) as DocRow[]);
    })();
  }, []);

  const selectedDocs = useMemo(() => {
    const map = new Map(docs.map((d) => [d.id, d]));
    return selectedIds.map((id) => map.get(id)).filter(Boolean) as DocRow[];
  }, [docs, selectedIds]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const openShare = () => setModalVisible(true);

  useEffect(() => {
    if (!modalVisible || selectedIds.length === 0) return;

    (async () => {
      try {
        setShareLoading(true);
        setShareError(null);
        setUrls({});

        const { data, error } = await supabase
          .from("documents")
          .select("id,title,fhir_path,summary_path")
          .in("id", selectedIds);

        if (error) throw error;
        const rows = (data ?? []) as DocPathsRow[];

        const pairs = await Promise.all(
          rows.map(async (row) => {
            const path = fileType === "fhir" ? row.fhir_path : row.summary_path;
            if (!path) throw new Error(`Missing ${fileType} path for: ${row.title ?? row.id}`);
            const signedUrl = await createSignedFileUrl(path, 60 * 10);
            return [row.id, signedUrl] as const;
          }),
        );

        const next: Record<string, string> = {};
        for (const [id, url] of pairs) next[id] = url;
        setUrls(next);
      } catch (e: any) {
        setShareError(e?.message ?? "Failed to create share link(s).");
      } finally {
        setShareLoading(false);
      }
    })();
  }, [modalVisible, selectedIds, fileType]);

  const copyAll = async () => {
    const lines = selectedDocs
      .map((d) => {
        const url = urls[d.id];
        if (!url) return null;
        return `${d.title ?? "(untitled)"}: ${url}`;
      })
      .filter(Boolean) as string[];

    if (lines.length === 0) return;
    await Clipboard.setStringAsync(lines.join("\n"));
  };

  return (
    <View style={styles.container}>
      {/* Polish: Replaced style with variant="h1" */}
      <AppText variant="h1">Share</AppText>

      <ShareFormatToggle value={fileType} onChange={setFileType} />

      {error ? <AppText style={{ color: "red" }}>{error}</AppText> : null}

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderItem={({ item }) => (
          /* Polish: Wrap list rows in Card */
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
        {/* Polish: Replaced Button with PrimaryButton */}
        <PrimaryButton
          label={
            selectedIds.length > 0
              ? `Share ${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"}`
              : "Select at least 1 document"
          }
          onPress={openShare}
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
            <AppText variant="title">
              Sharing • {fileType.toUpperCase()}
            </AppText>
            {/* Modal close often looks better as a subtle button or icon, but sticking to PrimaryButton for now */}
            <PrimaryButton label="Close" onPress={() => setModalVisible(false)} style={{ width: 80 }} />
          </View>

          {shareError ? <AppText style={{ color: "red" }}>{shareError}</AppText> : null}

          <View style={{ marginBottom: 10 }}>
            <PrimaryButton label="Copy all links" onPress={copyAll} />
          </View>

          {shareLoading ? (
            <AppText>Generating link(s)…</AppText>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {selectedDocs.map((doc) => {
                const url = urls[doc.id];
                return url ? (
                  /* Polish: Wrap ShareItemCard in Card */
                  <Card style={{ marginBottom: 12 }} key={doc.id}>
                    <ShareItemCard
                      title={doc.title ?? "(untitled)"}
                      url={url}
                    />
                  </Card>
                ) : (
                  /* Polish: Replaced manual border View with Card */
                  <Card key={doc.id} style={{ marginBottom: 12 }}>
                    <AppText variant="title">{doc.title ?? "(untitled)"}</AppText>
                    <AppText variant="caption">No link generated.</AppText>
                  </Card>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  bottom: { paddingTop: 6 },
  modalContainer: { flex: 1, padding: 16, gap: 12 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  }
});