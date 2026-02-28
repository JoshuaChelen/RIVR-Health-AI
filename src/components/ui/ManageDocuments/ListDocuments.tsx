// components/ui/ManageDocuments/ListDocuments.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, FlatList, ActivityIndicator, Animated, StyleSheet } from "react-native";
import { supabase } from "../../../lib/supabase";

import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { colors, radius } from "../../../theme/tokens";

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
  processing_error: string | null;
};

type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "doc"; key: string; doc: DocRow };

function IndeterminateBar() {
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 1100,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [x]);

  const translateX = x.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 260],
  });

  return (
    <View style={barStyles.track}>
      <Animated.View style={[barStyles.bar, { transform: [{ translateX }] }]} />
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: 10,
  },
  bar: {
    width: 140,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.teal,
    opacity: 0.7,
  },
});

function sectionLabel(status: string) {
  if (status === "uploaded") return "Ready to process";
  if (status === "processing") return "Processing";
  if (status === "failed") return "Failed";
  return "Other";
}

export function ListDocuments({
  refreshKey = 0,
  footer,
}: {
  refreshKey?: number;
  footer?: React.ReactNode;
}) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setError(null);

      const { data: auth, error: authError } = await supabase.auth.getUser();
      const user = auth?.user;

      if (authError || !user) {
        setError("Not authenticated");
        return;
      }

      const { data, error } = await supabase
        .from("documents")
        .select("id,title,created_at,status,processing_error")
        .eq("user_id", user.id)
        .neq("status", "processed") // hide processed docs completely
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      else setDocs((data ?? []) as DocRow[]);
    })();
  }, [refreshKey]);

  const rows: Row[] = useMemo(() => {
    const uploaded = docs.filter((d) => (d.status ?? "") === "uploaded");
    const processing = docs.filter((d) => (d.status ?? "") === "processing");
    const failed = docs.filter((d) => (d.status ?? "") === "failed");
    const other = docs.filter((d) => !["uploaded", "processing", "failed"].includes(d.status ?? ""));

    const out: Row[] = [];

    const pushSection = (label: string, items: DocRow[], key: string) => {
      if (!items.length) return;
      out.push({ kind: "header", key: `h-${key}`, label });
      for (const it of items) out.push({ kind: "doc", key: `d-${it.id}`, doc: it });
    };

    pushSection(sectionLabel("uploaded"), uploaded, "uploaded");
    pushSection(sectionLabel("processing"), processing, "processing");
    pushSection(sectionLabel("failed"), failed, "failed");
    pushSection("Other", other, "other");

    return out;
  }, [docs]);

  return (
    <View style={{ flex: 1 }}>
      {error ? (
        <AppText style={{ color: "red", marginBottom: 10, paddingHorizontal: 16 }}>
          {error}
        </AppText>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ListFooterComponent={footer ? <View style={{ marginTop: 12 }}>{footer}</View> : null}
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return (
              <AppText
                variant="label"
                style={{ paddingTop: 10, paddingBottom: 2, color: colors.muted }}
              >
                {item.label}
              </AppText>
            );
          }

          const d = item.doc;
          const st = d.status ?? "unknown";

          const statusColor =
            st === "uploaded" ? colors.blue :
            st === "processing" ? colors.teal :
            st === "failed" ? colors.danger :
            colors.muted;

          return (
            <Card style={{ gap: 6 }}>
              <AppText variant="title">{d.title ?? "(untitled)"}</AppText>

              <View style={styles.metaRow}>
                <View style={[styles.pill, { borderColor: statusColor }]}>
                  <View style={[styles.dot, { backgroundColor: statusColor }]} />
                  <AppText variant="caption" style={{ color: statusColor, fontWeight: "800" }}>
                    {st}
                  </AppText>
                </View>

                {st === "processing" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={colors.teal} />
                    <AppText variant="caption" style={{ color: colors.muted }}>
                      Working...
                    </AppText>
                  </View>
                ) : null}
              </View>

              <AppText variant="caption" style={{ color: colors.subtle }}>
                {new Date(d.created_at).toLocaleDateString()}
              </AppText>

              {st === "processing" ? <IndeterminateBar /> : null}

              {st === "failed" && d.processing_error ? (
                <AppText variant="caption" style={{ color: colors.danger }}>
                  {d.processing_error}
                </AppText>
              ) : null}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#fff",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});