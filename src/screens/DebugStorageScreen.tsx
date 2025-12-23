import React, { useEffect, useState } from "react";
import { View, Text, Button, TextInput, ScrollView } from "react-native";
import { supabase } from "../lib/supabase";
import { createSignedFileUrl } from "../lib/storage";

type StorageItem = {
  name: string;
  id?: string | null;
  updated_at?: string;
  created_at?: string;
  metadata?: any;
};

export function DebugStorageScreen() {
  const [userId, setUserId] = useState<string>("(loading)");
  const [folder, setFolder] = useState<string>("extracted-fhir");

  const [rootItems, setRootItems] = useState<StorageItem[]>([]);
  const [folderItems, setFolderItems] = useState<StorageItem[]>([]);

  const [selectedName, setSelectedName] = useState<string>("");
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function refreshAll() {
    setError("");
    setSignedUrl("");

    // auth
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) setError(sessionErr.message);
    setUserId(sessionData.session?.user?.id ?? "(not logged in)");

    // root list
    const { data: root, error: rootErr } = await supabase.storage.from("documents").list("");
    if (rootErr) setError((prev) => prev + `\nROOT list error: ${rootErr.message}`);
    setRootItems((root ?? []) as StorageItem[]);

    // folder list
    const prefix = folder.trim();
    const { data: items, error: listErr } = await supabase.storage
      .from("documents")
      .list(prefix, { limit: 100 });

    if (listErr) setError((prev) => prev + `\nFOLDER list error: ${listErr.message}`);
    setFolderItems((items ?? []) as StorageItem[]);
  }

  async function trySignedUrl() {
    setError("");
    setSignedUrl("");

    const prefix = folder.trim().replace(/^\//, "").replace(/\/+$/, "");
    const name = selectedName.trim().replace(/^\//, "");
    if (!prefix || !name) {
      setError("Pick a folder and a filename first.");
      return;
    }

    const path = `${prefix}/${name}`;

    try {
      const url = await createSignedFileUrl(path, 60 * 10);
      setSignedUrl(url);
    } catch (e: any) {
      setError(e?.message ?? "Failed to sign URL");
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Debug Storage</Text>

      <Text>User: {userId}</Text>

      <Button title="Refresh" onPress={refreshAll} />

      <View style={{ marginTop: 8 }}>
        <Text style={{ fontWeight: "700" }}>Bucket root (documents)</Text>
        {rootItems.length === 0 ? (
          <Text>(no items)</Text>
        ) : (
          rootItems.map((x) => (
            <Text key={x.name}>• {x.name}</Text>
          ))
        )}
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={{ fontWeight: "700" }}>Folder to inspect</Text>
        <TextInput
          value={folder}
          onChangeText={setFolder}
          autoCapitalize="none"
          style={{ borderWidth: 1, padding: 8, borderRadius: 6 }}
        />
        <Button title="List folder" onPress={refreshAll} />
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={{ fontWeight: "700" }}>Items in "{folder}"</Text>

        {folderItems.length === 0 ? (
          <Text>(no items)</Text>
        ) : (
          folderItems.map((x) => (
            <View key={x.name} style={{ paddingVertical: 6 }}>
              <Text>• {x.name}</Text>
              <Button title="Use this file" onPress={() => setSelectedName(x.name)} />
            </View>
          ))
        )}
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={{ fontWeight: "700" }}>Selected file</Text>
        <TextInput
          value={selectedName}
          onChangeText={setSelectedName}
          autoCapitalize="none"
          style={{ borderWidth: 1, padding: 8, borderRadius: 6 }}
        />

        <Button title="Try signed URL" onPress={trySignedUrl} />
      </View>

      {signedUrl ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: "700" }}>Signed URL</Text>
          <Text selectable>{signedUrl}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: "700" }}>Error</Text>
          <Text selectable>{error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
