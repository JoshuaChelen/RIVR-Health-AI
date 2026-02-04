import React, { useEffect, useState } from "react";
import { View, FlatList } from "react-native";
import { supabase } from "../../../lib/supabase";

// Import Primitives
import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";

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
      const { data: { user }, error: authError } = await supabase.auth.getUser();

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
    <View style={{ padding: 16 }}>
      {error ? <AppText style={{ color: "red", marginBottom: 10 }}>{error}</AppText> : null}

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />} // Adds spacing between cards
        renderItem={({ item }) => (
          <Card>
            <AppText variant="title">
              {item.title ?? "(untitled)"}
            </AppText>
            <AppText variant="caption" style={{ marginTop: 4 }}>
              {item.status ?? "unknown"} •{" "}
              {new Date(item.created_at).toLocaleDateString()}
            </AppText>
          </Card>
        )}
      />
    </View>
  );
}