import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Button,
  Modal,
  ScrollView,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { supabase } from "../../lib/supabase";
import { createSignedFileUrl } from "../../lib/storage";

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

  // id -> signed url
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

  // Generate links whenever modal opens (or selection/type changes while open)
  useEffect(() => {
    if (!modalVisible) return;
    if (selectedIds.length === 0) return;

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

            if (!path) {
              throw new Error(
                `Missing ${fileType} path for: ${row.title ?? row.id}`,
              );
            }

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
      <Text style={styles.h1}>Share</Text>

      <ShareFormatToggle value={fileType} onChange={setFileType} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderItem={({ item }) => (
          <SelectableDocRow
            title={item.title ?? "(untitled)"}
            subtitle={`${item.status ?? "unknown"} • ${new Date(item.created_at).toLocaleString()}`}
            selected={selectedIds.includes(item.id)}
            onToggle={() => toggleSelected(item.id)}
          />
        )}
      />

      <View style={styles.bottom}>
        <Button
          title={
            selectedIds.length > 0
              ? `Share ${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"}`
              : "Select at least 1 document"
          }
          onPress={openShare}
          disabled={selectedIds.length === 0}
        />
      </View>

      {/* Modal = your old ShareOut screen, but repeated per doc */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Sharing • {fileType.toUpperCase()}
            </Text>
            <Button title="Close" onPress={() => setModalVisible(false)} />
          </View>

          {shareError ? <Text style={styles.error}>{shareError}</Text> : null}

          <View style={{ marginBottom: 10 }}>
            <Button title="Copy all links" onPress={copyAll} />
          </View>

          {shareLoading ? (
            <Text>Generating link(s)…</Text>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {selectedDocs.map((doc) => {
                const url = urls[doc.id];
                return url ? (
                  <ShareItemCard
                    key={doc.id}
                    title={doc.title ?? "(untitled)"}
                    url={url}
                  />
                ) : (
                  <View key={doc.id} style={styles.missingCard}>
                    <Text style={{ fontWeight: "700" }}>
                      {doc.title ?? "(untitled)"}
                    </Text>
                    <Text>No link generated.</Text>
                  </View>
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
  h1: { fontSize: 18, fontWeight: "800" },
  error: { color: "red" },

  bottom: { paddingTop: 6 },

  modalContainer: { flex: 1, padding: 16, gap: 12 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: { fontSize: 16, fontWeight: "800" },

  missingCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginBottom: 12,
  },
});
