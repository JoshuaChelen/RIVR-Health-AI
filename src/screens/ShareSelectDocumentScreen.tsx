import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { supabase } from "../lib/supabase";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShareSelectDocument">;

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
};

export function ShareSelectDocumentScreen({ navigation }: Props) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={{ padding: 16 }}>
      {error ? <Text>{error}</Text> : null}
        
      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate("ShareSelectFormat", {
                documentId: item.id,
                title: item.title,
              })
            }
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600" }}>
              {item.title ?? "(untitled)"}
            </Text>
            <Text>
              {item.status ?? "unknown"} • {new Date(item.created_at).toLocaleString()}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
