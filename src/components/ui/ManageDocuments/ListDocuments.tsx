// components/ui/ManageDocuments/ListDocuments.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  FlatList,
  Animated,
  StyleSheet,
  Modal,
  Pressable,
} from "react-native";
import { supabase } from "../../../lib/supabase";
import { deleteDocument, cancelProcessing } from "../../../lib/documents";
import { AppText } from "../Primitives/AppText";
import { colors, radius, spacing, typescale, shadows } from "../../../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
  processing_error: string | null;
  pdf_path: string | null;
  source_type: string | null;
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

// ─── Processing animation ─────────────────────────────────────────────────────

const PROCESSING_MESSAGES = [
  "Analyzing document…",
  "Extracting key data…",
  "Building your timeline…",
  "Almost there…",
];

// Shown on manual-input (profile) cards — no file download or timeline involved.
const PROCESSING_MESSAGES_MANUAL = [
  "Analyzing your profile…",
  "Reading health data…",
  "Evaluating conditions…",
  "Almost there…",
];

const STOPPING_MESSAGES = [
  "Safely stopping…",
  "Finishing current step…",
  "Wrapping up…",
  "Almost done stopping…",
];

function useProcessingMessage(isStopping: boolean, isManual = false): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [isStopping]);
  useEffect(() => {
    const messages = isStopping ? STOPPING_MESSAGES : isManual ? PROCESSING_MESSAGES_MANUAL : PROCESSING_MESSAGES;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % messages.length);
    }, 2600);
    return () => clearInterval(t);
  }, [isStopping, isManual]);
  const messages = isStopping ? STOPPING_MESSAGES : isManual ? PROCESSING_MESSAGES_MANUAL : PROCESSING_MESSAGES;
  return messages[idx % messages.length];
}

function ShimmerBar({ stopping = false }: { stopping?: boolean }) {
  const position = useRef(new Animated.Value(0)).current;
  const brightness = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const slideDuration = stopping ? 2800 : 1400;
    const slide = Animated.loop(
      Animated.timing(position, {
        toValue: 1,
        duration: slideDuration,
        useNativeDriver: true,
      })
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(brightness, { toValue: stopping ? 0.5 : 1, duration: 700, useNativeDriver: true }),
        Animated.timing(brightness, { toValue: stopping ? 0.2 : 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    slide.start();
    breathe.start();
    return () => { slide.stop(); breathe.stop(); };
  }, [position, brightness, stopping]);

  const translateX = position.interpolate({
    inputRange: [0, 1],
    outputRange: [-90, 320],
  });

  return (
    <View style={shimmerStyles.track}>
      <Animated.View
        style={[
          shimmerStyles.highlight,
          stopping && shimmerStyles.highlightStopping,
          { opacity: brightness, transform: [{ translateX }] },
        ]}
      />
    </View>
  );
}

const shimmerStyles = StyleSheet.create({
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: spacing.sm,
  },
  highlight: {
    width: 90,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.teal,
  },
  highlightStopping: {
    backgroundColor: colors.muted,
  },
});

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  uploaded:   { label: "Ready",      color: colors.blue,    bg: colors.blueSoft    },
  queued:     { label: "Queued",     color: colors.warning, bg: colors.warnSoft    },
  processing: { label: "Analyzing",  color: colors.teal,    bg: colors.tealSoft    },
  stopping:   { label: "Stopping",   color: colors.muted,   bg: colors.bgSecondary },
  failed:     { label: "Failed",     color: colors.danger,  bg: colors.dangerSoft  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: colors.muted, bg: colors.bgSecondary };
  return (
    <View style={[badgeStyles.wrap, { backgroundColor: cfg.bg }]}>
      <View style={[badgeStyles.dot, { backgroundColor: cfg.color }]} />
      <AppText style={[badgeStyles.label, { color: cfg.color }]}>{cfg.label}</AppText>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
  },
});

// ─── File type icon ────────────────────────────────────────────────────────────

function FileTypeIcon({ path, sourceType }: { path: string | null; sourceType?: string | null }) {
  if (sourceType === "manual_input") {
    return (
      <View style={[fileIconStyles.wrap, fileIconStyles.profileWrap]}>
        <AppText style={[fileIconStyles.label, fileIconStyles.profileLabel]}>
          PRO
        </AppText>
      </View>
    );
  }
  const isAudio = path?.includes("voice-note") || path?.includes("voice_note") || path?.endsWith(".m4a");
  return (
    <View style={[fileIconStyles.wrap, isAudio ? fileIconStyles.audioWrap : fileIconStyles.pdfWrap]}>
      <AppText style={[fileIconStyles.label, isAudio ? fileIconStyles.audioLabel : fileIconStyles.pdfLabel]}>
        {isAudio ? "MIC" : "PDF"}
      </AppText>
    </View>
  );
}

const fileIconStyles = StyleSheet.create({
  wrap: {
    width: 40,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pdfWrap:     { backgroundColor: "#FEE2E2" },
  audioWrap:   { backgroundColor: colors.tealSoft },
  profileWrap: { backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.tealBorder },
  label: {
    fontSize: 10,
    fontWeight: typescale.weight.black,
    letterSpacing: 0.5,
  },
  pdfLabel:     { color: "#B91C1C" },
  audioLabel:   { color: colors.teal },
  profileLabel: { color: colors.teal },
});

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={sectionStyles.row}>
      <View style={sectionStyles.accent} />
      <AppText style={sectionStyles.label}>{label}</AppText>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  accent: {
    width: 3,
    height: 12,
    borderRadius: 2,
    backgroundColor: colors.teal,
  },
  label: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});

// ─── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  confirm,
  onClose,
  onConfirm,
}: {
  confirm: { mode: "delete" | "cancel"; doc: DocRow } | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!confirm) return null;
  const isDelete = confirm.mode === "delete";
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={modalStyles.backdrop} onPress={onClose}>
        <Pressable style={modalStyles.sheet} onPress={() => {}}>
          {/* Header accent */}
          <View style={[modalStyles.accentBar, isDelete ? modalStyles.accentDanger : modalStyles.accentTeal]} />

          <View style={modalStyles.body}>
            <AppText style={modalStyles.title}>
              {isDelete ? "Remove this record?" : "Stop processing?"}
            </AppText>
            <AppText style={modalStyles.message}>
              {isDelete
                ? confirm.doc.source_type === "manual_input"
                  ? "Your profile data is unchanged — only this record is removed. It will reappear next time you save your profile."
                  : `"${confirm.doc.title ?? "This file"}" will be permanently removed from your documents.`
                : confirm.doc.source_type === "manual_input"
                ? "Processing will stop. Your profile record stays so you can process it again later."
                : "Processing will stop. The file stays so you can delete or reprocess it later."}
            </AppText>

            <View style={modalStyles.btnRow}>
              <Pressable
                style={({ pressed }) => [modalStyles.btnSecondary, pressed && { opacity: 0.75 }]}
                onPress={onClose}
              >
                <AppText style={modalStyles.btnSecondaryText}>Keep</AppText>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  modalStyles.btnPrimary,
                  isDelete ? modalStyles.btnDanger : modalStyles.btnOrange,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={onConfirm}
              >
                <AppText style={modalStyles.btnPrimaryText}>
                  {isDelete ? "Remove permanently" : "Stop processing"}
                </AppText>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(13,27,42,0.45)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadows.lg,
  },
  accentBar: {
    height: 4,
  },
  accentDanger: { backgroundColor: colors.danger },
  accentTeal:   { backgroundColor: colors.teal },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  message: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  btnRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  btnSecondary: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
  },
  btnPrimary: {
    flex: 1.4,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDanger: { backgroundColor: colors.danger },
  btnOrange: { backgroundColor: colors.warning },
  btnPrimaryText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
});

// ─── Document card ─────────────────────────────────────────────────────────────

function DocCard({
  doc,
  anim,
  onDelete,
  onCancel,
  isStopping,
}: {
  doc: DocRow;
  anim: DocAnim;
  onDelete: () => void;
  onCancel: () => void;
  isStopping?: boolean;
}) {
  const isManual = doc.source_type === "manual_input";
  const processingMsg = useProcessingMessage(!!isStopping, isManual);
  // Use a virtual "stopping" status for display when the user has requested stop
  const st = isStopping && doc.status === "processing" ? "stopping" : (doc.status ?? "unknown");

  const dateStr = new Date(doc.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const isAudio =
    !isManual &&
    (doc.pdf_path?.includes("voice-note") ||
      doc.pdf_path?.includes("voice_note") ||
      doc.pdf_path?.endsWith(".m4a"));

  const fileType = isManual ? "Manual input" : isAudio ? "Voice note" : "PDF";

  return (
    <Animated.View
      style={[
        cardStyles.wrapper,
        { opacity: anim.opacity, transform: [{ scale: anim.scale }] },
      ]}
    >
      <View style={cardStyles.card}>
        {/* Top row: icon + info + status */}
        <View style={cardStyles.topRow}>
          <FileTypeIcon path={doc.pdf_path} sourceType={doc.source_type} />

          <View style={cardStyles.infoBlock}>
            <AppText style={cardStyles.title} numberOfLines={2}>
              {doc.title ?? "(untitled)"}
            </AppText>
            <AppText style={cardStyles.meta}>
              {dateStr} · {fileType}
            </AppText>
          </View>

          <StatusBadge status={st} />
        </View>

        {/* Processing / stopping progress */}
        {(st === "processing" || st === "stopping") ? (
          <View style={cardStyles.progressBlock}>
            <ShimmerBar stopping={st === "stopping"} />
            <AppText style={[cardStyles.processingMsg, st === "stopping" && cardStyles.stoppingMsg]}>
              {processingMsg}
            </AppText>
          </View>
        ) : null}

        {/* Error */}
        {st === "failed" && doc.processing_error ? (
          <View style={cardStyles.errorBlock}>
            <View style={cardStyles.errorDot} />
            <AppText style={cardStyles.errorText} numberOfLines={3}>
              {doc.processing_error}
            </AppText>
          </View>
        ) : null}

        {/* Divider + action */}
        <View style={cardStyles.footer}>
          {st === "processing" ? (
            <Pressable
              style={[cardStyles.actionBtn, cardStyles.cancelBtn, isStopping && cardStyles.cancelBtnStopping]}
              onPress={isStopping ? undefined : onCancel}
              hitSlop={8}
              disabled={isStopping}
            >
              <AppText style={[cardStyles.cancelBtnText, isStopping && cardStyles.cancelBtnTextStopping]}>
                {isStopping ? "Stopping…" : "Stop processing"}
              </AppText>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [cardStyles.actionBtn, cardStyles.removeBtn, pressed && { opacity: 0.7 }]}
              onPress={onDelete}
              hitSlop={8}
            >
              <AppText style={cardStyles.removeBtnText}>Remove</AppText>
            </Pressable>
          )}
        </View>
      </View>

      {/* Flash overlays */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Animated.View
          style={[cardStyles.flash, { backgroundColor: colors.green, opacity: anim.flashGreen }]}
        />
        <Animated.View
          style={[cardStyles.flash, { backgroundColor: colors.danger, opacity: anim.flashRed }]}
        />
      </View>
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  wrapper: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },

  // Top row
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  infoBlock: {
    flex: 1,
    gap: 3,
    paddingTop: 2,
  },
  title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
    lineHeight: typescale.size.base * typescale.lineHeight.normal,
  },
  meta: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },

  // Processing
  progressBlock: {
    gap: spacing.xxs,
  },
  processingMsg: {
    fontSize: typescale.size.xs,
    color: colors.teal,
    fontWeight: typescale.weight.medium,
    marginTop: 3,
  },
  stoppingMsg: {
    color: colors.muted,
  },

  // Error
  errorBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xxs,
  },
  errorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.danger,
    marginTop: 4,
  },
  errorText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: colors.danger,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Footer actions
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.xxs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.xs,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  cancelBtn: {
    borderColor: colors.tealBorder,
    backgroundColor: colors.tealSoft,
  },
  cancelBtnStopping: {
    borderColor: colors.border,
    backgroundColor: colors.bgSecondary,
    opacity: 0.7,
  },
  cancelBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  cancelBtnTextStopping: {
    color: colors.muted,
  },
  removeBtn: {
    borderColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  removeBtnText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.muted,
  },

  // Flash overlay
  flash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg,
  },
});

// ─── Main component ────────────────────────────────────────────────────────────

function sectionLabel(status: string) {
  if (status === "uploaded")   return "Ready to process";
  if (status === "processing") return "Processing";
  if (status === "failed")     return "Failed";
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
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const pending = docs.filter((d) => (d.status ?? "") === "uploaded").length;
    onPendingCountChange?.(pending);
  }, [docs, onPendingCountChange]);

  async function runCancel(doc: DocRow) {
    if (!userId) { setError("Not signed in."); return; }
    // Show "Stopping…" immediately while the worker acknowledges the signal.
    // Do NOT optimistically update doc status — the worker handles the revert.
    setStoppingIds((prev) => new Set(prev).add(doc.id));
    try {
      await cancelProcessing(doc.id, userId);
      onStatusChange?.();
    } catch (e: any) {
      setStoppingIds((prev) => { const s = new Set(prev); s.delete(doc.id); return s; });
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
        opacity:    new Animated.Value(fadeIn ? 0 : 1),
        scale:      new Animated.Value(fadeIn ? 0.94 : 1),
        flashGreen: new Animated.Value(0),
        flashRed:   new Animated.Value(0),
      };
      animsRef.current.set(id, a);

      if (fadeIn) {
        Animated.parallel([
          Animated.spring(a.opacity, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 130 }),
          Animated.spring(a.scale,   { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 130 }),
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
    const kind  = opts.kind  ?? "processed";
    const flash = kind === "delete" ? a.flashRed : a.flashGreen;

    a.flashGreen.setValue(0);
    a.flashRed.setValue(0);

    const speed   = opts.speed ?? "normal";
    const tFlashIn  = speed === "fast" ? 70  : 180;
    const tFlashOut = speed === "fast" ? 90  : 300;
    const tFade     = speed === "fast" ? 180 : 320;

    Animated.sequence([
      Animated.timing(flash,    { toValue: 0.55, duration: tFlashIn,  useNativeDriver: true }),
      Animated.timing(flash,    { toValue: 0,    duration: tFlashOut, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(a.opacity, { toValue: 0,    duration: tFade, useNativeDriver: true }),
        Animated.timing(a.scale,   { toValue: 0.93, duration: tFade, useNativeDriver: true }),
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

  // Initial fetch
  useEffect(() => {
    if (!userId) return;
    setError(null);
    animsRef.current.clear();
    animatingOutRef.current.clear();

    supabase
      .from("documents")
      .select("id,title,created_at,status,processing_error,pdf_path,source_type")
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
            getAnim(updated.id);
            animateOut(updated.id, { kind: "processed", speed: "normal" }, () => {
              setDocs((prev) => prev.filter((d) => d.id !== updated.id));
              animsRef.current.delete(updated.id);
            });
          } else {
            // Worker reverted doc to 'uploaded' after acknowledging cancellation
            if (updated.status === "uploaded") {
              setStoppingIds((prev) => { const s = new Set(prev); s.delete(updated.id); return s; });
            }
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
          getAnim(newDoc.id, true);
          setDocs((prev) => {
            if (prev.some((d) => d.id === newDoc.id)) return prev;
            return [newDoc, ...prev];
          });
          onStatusChange?.();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  function handleDelete(doc: DocRow) { setConfirm({ mode: "delete", doc }); }
  function handleCancel(doc: DocRow) { setConfirm({ mode: "cancel", doc }); }

  async function runDelete(doc: DocRow) {
    if (!userId) return;

    const backend = deleteDocument(doc.id, userId, doc.pdf_path);
    deleteInFlightRef.current.add(doc.id);

    animateOut(doc.id, { kind: "delete", speed: "fast" }, () => {
      if (!deleteInFlightRef.current.has(doc.id)) return;
      deleteInFlightRef.current.delete(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      animsRef.current.delete(doc.id);
      onStatusChange?.();
    });

    try {
      await backend;
    } catch (e: any) {
      deleteInFlightRef.current.delete(doc.id);
      animsRef.current.delete(doc.id);
      setDocs((prev) => {
        if (prev.some((d) => d.id === doc.id)) return prev;
        return [doc, ...prev];
      });
      setError(e?.message ?? "Could not delete.");
    }
  }

  // Polling fallback
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
        .select("id,title,created_at,status,processing_error,pdf_path,source_type")
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
          if (updated.status === "uploaded" || updated.status === "failed") {
            setStoppingIds((prev) => { const s = new Set(prev); s.delete(updated.id); return s; });
          }
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
    const uploaded   = docs.filter((d) => (d.status ?? "") === "uploaded");
    const processing = docs.filter((d) => (d.status ?? "") === "processing");
    const failed     = docs.filter((d) => (d.status ?? "") === "failed");
    const other      = docs.filter((d) => !["uploaded", "processing", "failed"].includes(d.status ?? ""));

    const out: Row[] = [];
    const pushSection = (label: string, items: DocRow[], key: string) => {
      if (!items.length) return;
      out.push({ kind: "header", key: `h-${key}`, label });
      for (const it of items) out.push({ kind: "doc", key: `d-${it.id}`, doc: it });
    };

    pushSection(sectionLabel("uploaded"),   uploaded,   "uploaded");
    pushSection(sectionLabel("processing"), processing, "processing");
    pushSection(sectionLabel("failed"),     failed,     "failed");
    pushSection("Other",                    other,      "other");

    return out;
  }, [docs]);

  return (
    <View style={{ flex: 1 }}>
      {error ? (
        <View style={listStyles.errorBanner}>
          <AppText style={listStyles.errorBannerText}>{error}</AppText>
        </View>
      ) : null}

      <ConfirmModal
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          if (c.mode === "delete") await runDelete(c.doc);
          else await runCancel(c.doc);
        }}
      />

      <FlatList
        data={rows}
        extraData={docs}
        keyExtractor={(item) => item.key}
        ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        contentContainerStyle={listStyles.container}
        ListHeaderComponent={
          header ? (
            <View style={listStyles.headerWrap}>{header}</View>
          ) : null
        }
        ListFooterComponent={
          footer ? (
            <View style={{ marginTop: spacing.sm }}>{footer}</View>
          ) : null
        }
        ListEmptyComponent={
          <View style={listStyles.empty}>
            <AppText style={listStyles.emptySymbol}>📂</AppText>
            <AppText style={listStyles.emptyTitle}>No documents yet</AppText>
            <AppText style={listStyles.emptyBody}>
  Upload a file, record a voice note, or save a change in Medical Profile to get started.
</AppText>
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return <SectionHeader label={item.label} />;
          }

          const d = item.doc;
          const anim = getAnim(d.id);

          return (
            <DocCard
              doc={d}
              anim={anim}
              onDelete={() => handleDelete(d)}
              onCancel={() => handleCancel(d)}
              isStopping={stoppingIds.has(d.id)}
            />
          );
        }}
      />
    </View>
  );
}

const listStyles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerWrap: {
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderBottomWidth: 1,
    borderBottomColor: "#FECACA",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorBannerText: {
    fontSize: typescale.size.sm,
    color: colors.danger,
    fontWeight: typescale.weight.medium,
  },
  empty: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptySymbol: {
    fontSize: 36,
    lineHeight: 44,
  },
  emptyTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
  emptyBody: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    maxWidth: 260,
  },
});
