import React, { useEffect, useState } from "react";
import {  View, Text, FlatList } from "react-native";
import { supabase } from "../../../lib/supabase";
type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
};

export function ListDocuments() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
  (async () => {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      setError("Not authenticated");
      return;
    }

    const { data, error } = await supabase
      .from("documents")
      .select("id,title,created_at,status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setDocs((data ?? []) as DocRow[]);
  })();
}, []);


 
  return (
    <View style={{ padding: 16, gap: 12 }}>

      {error ? <Text>{error}</Text> : null}

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: "600" }}>
              {item.title ?? "(untitled)"}
            </Text>
            <Text>
              {item.status ?? "unknown"} •{" "}
              {new Date(item.created_at).toLocaleString()}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
