// components/ui/ManageDocuments/ListDocuments.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  Animated,
  StyleSheet,
  Modal,
  Pressable,
} from "react-native";
import { supabase } from "../../../lib/supabase";
import { deleteDocument, cancelProcessing } from "../../../lib/documents";
import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { colors, radius } from "../../../theme/tokens";

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
  processing_error: string | null;
  pdf_path: string | null;
};

type DocAnim = {
  opacity: Animated.Value;
  scale: Animated.Value;
  flashGreen: Animated.Value;
  flashRed: Animated.Value;
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
  header,
  footer,
  onStatusChange,
  onPendingCountChange,
}: {
  refreshKey?: number;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onStatusChange?: () => void;
  onPendingCountChange?: (n: number) => void;
}) {
  
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { mode: "delete" | "cancel"; doc: DocRow }>(null);


  useEffect(() => {
    const pending = docs.filter((d) => (d.status ?? "") === "uploaded").length;
    onPendingCountChange?.(pending);
  }, [docs, onPendingCountChange]);


async function runCancel(doc: DocRow) {
  if (!userId) {
    setError("Not signed in.");
    return;
  }
  try {
    await cancelProcessing(doc.id, userId);
    setDocs((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, status: "uploaded", processing_error: null } : d))
    );
    onStatusChange?.();
  } catch (e: any) {
    setError(e?.message ?? "Could not cancel processing.");
  }
}

  const animsRef = useRef<Map<string, DocAnim>>(new Map());
  const animatingOutRef = useRef<Set<string>>(new Set());
  const docsRef = useRef<DocRow[]>([]);
  const deleteInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => { docsRef.current = docs; }, [docs]);

  function getAnim(id: string, fadeIn = false): DocAnim {
  if (!animsRef.current.has(id)) {
    const a: DocAnim = {
      opacity: new Animated.Value(fadeIn ? 0 : 1),
      scale: new Animated.Value(fadeIn ? 0.94 : 1),
      flashGreen: new Animated.Value(0),
      flashRed: new Animated.Value(0),
    };
    animsRef.current.set(id, a);

    if (fadeIn) {
      Animated.parallel([
        Animated.spring(a.opacity, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 130 }),
        Animated.spring(a.scale, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 130 }),
      ]).start();
    }
  }
  return animsRef.current.get(id)!;
}

function animateOut(
  id: string,
  opts: { kind?: "processed" | "delete"; speed?: "fast" | "normal" } = {},
  onDone: () => void
) {
  if (animatingOutRef.current.has(id)) return;
  animatingOutRef.current.add(id);

  const a = getAnim(id);

  const kind = opts.kind ?? "processed";
  const flash = kind === "delete" ? a.flashRed : a.flashGreen;

  // reset flashes so we never show the wrong one
  a.flashGreen.setValue(0);
  a.flashRed.setValue(0);

  const speed = opts.speed ?? "normal";
  const tFlashIn = speed === "fast" ? 70 : 180;
  const tFlashOut = speed === "fast" ? 90 : 300;
  const tFade = speed === "fast" ? 180 : 320;

  Animated.sequence([
    Animated.timing(flash, { toValue: 0.55, duration: tFlashIn, useNativeDriver: true }),
    Animated.timing(flash, { toValue: 0, duration: tFlashOut, useNativeDriver: true }),
    Animated.parallel([
      Animated.timing(a.opacity, { toValue: 0, duration: tFade, useNativeDriver: true }),
      Animated.timing(a.scale, { toValue: 0.93, duration: tFade, useNativeDriver: true }),
    ]),
  ]).start(() => {
    animatingOutRef.current.delete(id);
    onDone();
  });
}

  // Resolve userId once
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null);
    });
  }, []);

  // Initial fetch (also re-runs on manual refreshKey bump)
  useEffect(() => {
    if (!userId) return;
    setError(null);
    animsRef.current.clear();
    animatingOutRef.current.clear();

    supabase
      .from("documents")
      .select("id,title,created_at,status,processing_error,pdf_path")
      .eq("user_id", userId)
      .neq("status", "processed")
      .order("created_at", { ascending: false })
      .then(({ data, error: fetchErr }) => {
        if (fetchErr) setError(fetchErr.message);
        else setDocs((data ?? []) as DocRow[]);
      });
  }, [refreshKey, userId]);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`docs-status:${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "documents", filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as DocRow;

          if (updated.status === "processed") {
            // Ensure anim exists before animating out
            getAnim(updated.id);
            animateOut(updated.id, { kind: "processed", speed: "normal" }, () => {
              setDocs((prev) => prev.filter((d) => d.id !== updated.id));
              animsRef.current.delete(updated.id);
            });
          } else {
            setDocs((prev) => {
              const exists = prev.some((d) => d.id === updated.id);
              if (exists) return prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d));
              if (updated.status !== "processed") return [updated, ...prev];
              return prev;
            });
          }

          onStatusChange?.();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "documents", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newDoc = payload.new as DocRow;
          if (newDoc.status === "processed") return;
          // Create fade-in anim before setState so it's ready when the item renders
          getAnim(newDoc.id, true);
          setDocs((prev) => {
            if (prev.some((d) => d.id === newDoc.id)) return prev;
            return [newDoc, ...prev];
          });
          onStatusChange?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

function handleDelete(doc: DocRow) {
  setConfirm({ mode: "delete", doc });
}

async function runDelete(doc: DocRow) {
  if (!userId) return;

  const backend = deleteDocument(doc.id, userId, doc.pdf_path);

  // mark delete in flight
  deleteInFlightRef.current.add(doc.id);

  // animate immediately, red + fast
  animateOut(doc.id, { kind: "delete", speed: "fast" }, () => {
    // if we already rolled back, do nothing
    if (!deleteInFlightRef.current.has(doc.id)) return;

    deleteInFlightRef.current.delete(doc.id);

    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    animsRef.current.delete(doc.id);
    onStatusChange?.();
  });

  try {
    await backend;
  } catch (e: any) {
    // rollback: cancel the pending removal
    deleteInFlightRef.current.delete(doc.id);

    // make sure we can fade in even if an anim existed
    animsRef.current.delete(doc.id);

    setDocs((prev) => {
      if (prev.some((d) => d.id === doc.id)) return prev;
      return [doc, ...prev];
    });

    setError(e?.message ?? "Could not delete.");
  }
}

function handleCancel(doc: DocRow) {
  setConfirm({ mode: "cancel", doc });
}

  // Polling fallback: if realtime misses the "processed" event, catch it here
  const hasProcessing = docs.some((d) => d.status === "processing");
  useEffect(() => {
    if (!userId || !hasProcessing) return;

    const interval = setInterval(async () => {
      const processingIds = docsRef.current
        .filter((d) => d.status === "processing")
        .map((d) => d.id);
      if (processingIds.length === 0) return;

      const { data } = await supabase
        .from("documents")
        .select("id,title,created_at,status,processing_error,pdf_path")
        .eq("user_id", userId)
        .in("id", processingIds);

      if (!data) return;

      for (const updated of data) {
        const current = docsRef.current.find((d) => d.id === updated.id);
        if (!current) continue;

        if (updated.status === "processed") {
          animateOut(updated.id, { kind: "processed", speed: "normal" }, () => {
            setDocs((prev) => prev.filter((d) => d.id !== updated.id));
            animsRef.current.delete(updated.id);
            onStatusChange?.();
          });
        } else if (updated.status !== current.status) {
          setDocs((prev) =>
            prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d))
          );
          onStatusChange?.();
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [userId, hasProcessing]);

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


      <Modal
        transparent
        visible={!!confirm}
        animationType="fade"
        onRequestClose={() => setConfirm(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setConfirm(null)}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <AppText variant="title">
              {confirm?.mode === "delete" ? "Delete file?" : "Stop processing?"}
            </AppText>

            <AppText variant="caption" style={{ marginTop: 8, color: colors.subtle }}>
              {confirm?.mode === "delete"
                ? `"${confirm?.doc.title ?? "This file"}" will be permanently removed.`
                : "The file will stay so you can delete or reprocess it later."}
            </AppText>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setConfirm(null)}
                style={({ pressed }) => [styles.modalBtn, pressed && { opacity: 0.8 }]}
              >
                <AppText variant="body" style={{ fontWeight: "700" }}>Close</AppText>
              </Pressable>

              <Pressable
                onPress={async () => {
                  const c = confirm;
                  setConfirm(null);
                  if (!c) return;
                  if (c.mode === "delete") await runDelete(c.doc);
                  else await runCancel(c.doc);
                }}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnDanger,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <AppText variant="body" style={{ color: "#fff", fontWeight: "700" }}>
                  {confirm?.mode === "delete" ? "Delete" : "Cancel processing"}
                </AppText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <FlatList
        data={rows}
        extraData={docs}
        keyExtractor={(item) => item.key}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ListHeaderComponent={header ? <View style={{ paddingBottom: 12, gap: 12 }}>{header}</View> : null}
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
          const anim = getAnim(d.id);

          const statusColor =
            st === "uploaded" ? colors.blue :
            st === "processing" ? colors.teal :
            st === "failed" ? colors.danger :
            colors.muted;

          return (
            <Animated.View style={{ opacity: anim.opacity, transform: [{ scale: anim.scale }] }}>
              <Card style={{ gap: 6 }}>
                {/* Title row with action button */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <AppText variant="title" style={{ flex: 1 }}>{d.title ?? "(untitled)"}</AppText>
                  {st === "processing" ? (
                    <Pressable
                      onPress={() => handleCancel(d)}
                      hitSlop={12}
                      style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                    >
                      <AppText style={styles.cancelIcon}>✕</AppText>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => handleDelete(d)}
                      hitSlop={12}
                      style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                    >
                      <AppText style={styles.deleteIcon}>🗑</AppText>
                    </Pressable>
                  )}
                </View>

                <View style={styles.metaRow}>
                  <View style={[styles.pill, { borderColor: statusColor }]}>
                    <View style={[styles.dot, { backgroundColor: statusColor }]} />
                    <AppText variant="caption" style={{ color: statusColor, fontWeight: "700" }}>
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
              {/* Green success flash overlay — rendered after Card so it's visually on top,
                  no zIndex needed since later siblings render above earlier ones */}
              <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                <Animated.View
                  style={{
                    flex: 1,
                    backgroundColor: colors.green,
                    opacity: anim.flashGreen,
                    borderRadius: 18,
                  }}
                />
                <Animated.View
                  style={{
                    ...StyleSheet.absoluteFillObject,
                    backgroundColor: colors.danger,
                    opacity: anim.flashRed,
                    borderRadius: 18,
                  }}
                />
              </View>
            </Animated.View>
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
    backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actionBtn: {
  width: 36,
  height: 36,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  },
  cancelIcon: { fontSize: 16, color: colors.danger },
  deleteIcon: { fontSize: 16 },
  backdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.35)",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
},
confirmCard: {
  width: "100%",
  maxWidth: 420,
  backgroundColor: colors.surface,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.border,
  padding: 14,
},
modalBtn: {
  flex: 1,
  height: 46,
  borderRadius: 12,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
},
modalBtnDanger: {
  borderColor: colors.danger,
  backgroundColor: colors.danger,
},
});