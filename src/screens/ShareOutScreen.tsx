// src/screens/ShareOutScreen.tsx
import React, { useEffect, useState } from "react";
import { View, Text, Button } from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

import { supabase } from "../lib/supabase";
import { createSignedFileUrl } from "../lib/storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShareOut">;

type DocPathsRow = {
  fhir_path: string | null;
  summary_path: string | null;
};

export function ShareOutScreen({ route }: Props) {
  const { documentId, fileType, title } = route.params;

  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setUrl("");
        setError(null);

        const { data, error } = await supabase
          .from("documents")
          .select("fhir_path,summary_path")
          .eq("id", documentId)
          .single();

        if (error) throw error;

        const row = data as DocPathsRow;
        const path = fileType === "fhir" ? row.fhir_path : row.summary_path;

        if (!path) throw new Error(`Missing ${fileType} path on this document row.`);

        // ✅ This now auto-fixes top-level folder mismatches
        const signedUrl = await createSignedFileUrl(path, 60 * 10);
        setUrl(signedUrl);
      } catch (e: any) {
        setError(e?.message ?? "Failed to create share link.");
      }
    })();
  }, [documentId, fileType]);

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>
        {title ?? "(untitled)"} • {fileType.toUpperCase()}
      </Text>

      {error ? <Text>{error}</Text> : null}

      {url ? (
        <>
          <Text selectable>{url}</Text>
          <Button title="Copy link" onPress={() => Clipboard.setStringAsync(url)} />

          <View style={{ alignItems: "center", marginTop: 16 }}>
            <QRCode value={url} size={200} />
          </View>
        </>
      ) : (
        <Text>Generating link…</Text>
      )}
    </View>
  );
}
