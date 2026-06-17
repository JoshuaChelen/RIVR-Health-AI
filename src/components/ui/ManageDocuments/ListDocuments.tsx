// components/ui/ManageDocuments/ListDocuments.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  FlatList,
  Animated,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../../navigation/appTypes";
import { useSession } from "../../../context/SessionContext";
import { listDocuments, listJobs } from "../../../lib/api/data";
import { deleteDocument, cancelProcessing } from "../../../lib/documents";
import { AppText } from "../Primitives/AppText";
import { BottomSheet } from "../Primitives/BottomSheet";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radius, spacing, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocRow = {
  id: string;
  title: string | null;
  created_at: string;
  status: string | null;
  processing_error: string | null;
  pdf_path: string | null;
  source_type: string | null;
  detached_at: string | null;
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

// ─── Job stage → user-facing label + progress percent ─────────────────────────
// Mirrors the setStage() calls in the Django jobs pipeline (backend/apps/jobs/pipeline.py). Single-doc jobs progress
// smoothly through these. Multi-doc jobs reuse the per-doc percentages until
// all docs are done, then move into the job-level evaluation/backfill stages.
type StageInfo = { label: string; percent: number };

const STAGE_INFO: Record<string, StageInfo> = {
  started:                { label: "Starting",             percent: 1  },
  fetching_documents:     { label: "Reading record",       percent: 5  },
  downloading_file:       { label: "Downloading",          percent: 15 },
  transcribing_audio:     { label: "Transcribing audio",   percent: 35 },
  extracting_text:        { label: "Extracting text",      percent: 30 },
  ocr_pdf:                { label: "Reading scanned text", percent: 45 },
  openai_extract:         { label: "Analyzing with AI",    percent: 65 },
  document_done:          { label: "Almost done",          percent: 80 },
  loading_manual_profile: { label: "Loading profile",      percent: 85 },
  openai_eval:            { label: "Evaluating health",    percent: 90 },
  saving_profile:         { label: "Saving",               percent: 95 },
  ai_backfill:            { label: "Updating profile",     percent: 98 },
  safe_quitting:          { label: "Stopping",             percent: 50 },
};

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

const SHIMMER_HIGHLIGHT_WIDTH = 90;

function ShimmerBar({ stopping = false }: { stopping?: boolean }) {
  const { shimmerStyles } = useStyles();
  const position = useRef(new Animated.Value(0)).current;
  const brightness = useRef(new Animated.Value(0.6)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    // Wait for the first onLayout measurement before starting so the
    // outputRange is correct on the first frame and we never see the
    // highlight pause inside the visible track.
    if (trackWidth <= 0) return;

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
  }, [position, brightness, stopping, trackWidth]);

  // Always L → R: start the highlight just off the left edge and end it just
  // past the right edge so the reset (position 1 → 0) happens entirely
  // off-screen. No visible R → L snap, no pause at the right edge.
  const translateX = position.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHIMMER_HIGHLIGHT_WIDTH, trackWidth || SHIMMER_HIGHLIGHT_WIDTH],
  });

  return (
    <View
      style={shimmerStyles.track}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && w !== trackWidth) setTrackWidth(w);
      }}
    >
      {trackWidth > 0 ? (
        <Animated.View
          style={[
            shimmerStyles.highlight,
            stopping && shimmerStyles.highlightStopping,
            { opacity: brightness, transform: [{ translateX }] },
          ]}
        />
      ) : null}
    </View>
  );
}

// Real progress bar bound to the job's stage percentage. Used in place of
// the indeterminate ShimmerBar once the worker has emitted at least one stage
// update, so the user sees the bar actually advance through the job.
function ProgressBar({ percent, stopping = false }: { percent: number; stopping?: boolean }) {
  const { shimmerStyles } = useStyles();
  const animPercent = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animPercent, {
      toValue: Math.max(0, Math.min(100, percent)),
      duration: 600,
      useNativeDriver: false, // width animation requires JS driver
    }).start();
  }, [percent, animPercent]);

  const width = animPercent.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={shimmerStyles.track}>
      <Animated.View
        style={[
          shimmerStyles.highlight,
          stopping && shimmerStyles.highlightStopping,
          { width }, // overrides the shimmer's fixed 90px width
        ]}
      />
    </View>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function getStatusConfig(colors: import("../../../context/ThemeContext").Colors) {
  return {
    uploaded:   { label: "Ready",      color: colors.blue,    bg: colors.blueSoft    },
    queued:     { label: "Queued",     color: colors.warning, bg: colors.warnSoft    },
    processing: { label: "Analyzing",  color: colors.teal,    bg: colors.tealSoft    },
    stopping:   { label: "Stopping",   color: colors.muted,   bg: colors.bgSecondary },
    failed:     { label: "Failed",     color: colors.danger,  bg: colors.dangerSoft  },
  } as Record<string, { label: string; color: string; bg: string }>;
}

function StatusBadge({ status }: { status: string }) {
  const { colors } = useTheme();
  const STATUS_CONFIG = getStatusConfig(colors);
  const { badgeStyles } = useStyles();
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: colors.muted, bg: colors.bgSecondary };
  return (
    <View style={[badgeStyles.wrap, { backgroundColor: cfg.bg }]}>
      <View style={[badgeStyles.dot, { backgroundColor: cfg.color }]} />
      <AppText style={[badgeStyles.label, { color: cfg.color }]}>{cfg.label}</AppText>
    </View>
  );
}

// ─── File type icon ────────────────────────────────────────────────────────────

function FileTypeIcon({ path, sourceType }: { path: string | null; sourceType?: string | null }) {
  const { fileIconStyles } = useStyles();
  if (sourceType === "manual_input") {
    return (
      <View style={[fileIconStyles.wrap, fileIconStyles.profileWrap]}>
        <AppText style={[fileIconStyles.label, fileIconStyles.profileLabel]}>
          PRO
        </AppText>
      </View>
    );
  }
  if (sourceType === "scanned_pdf") {
    return (
      <View style={[fileIconStyles.wrap, fileIconStyles.scanWrap]}>
        <AppText style={[fileIconStyles.label, fileIconStyles.scanLabel]}>SCAN</AppText>
      </View>
    );
  }
  if (sourceType === "image_gallery" || sourceType === "image_camera") {
    return (
      <View style={[fileIconStyles.wrap, fileIconStyles.imageWrap]}>
        <AppText style={[fileIconStyles.label, fileIconStyles.imageLabel]}>IMG</AppText>
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


// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  const { sectionStyles } = useStyles();
  return (
    <View style={sectionStyles.row}>
      <View style={sectionStyles.accent} />
      <AppText style={sectionStyles.label}>{label}</AppText>
    </View>
  );
}

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
  const { modalStyles } = useStyles();
  if (!confirm) return null;
  const isDelete = confirm.mode === "delete";
  return (
    <BottomSheet
      visible
      onClose={onClose}
      accent={isDelete ? "danger" : "teal"}
      title={isDelete ? "Remove this record?" : "Stop processing?"}
      message={
        isDelete
          ? confirm.doc.source_type === "manual_input"
            ? "Your profile data is unchanged — only this record is removed. It will reappear next time you save your profile."
            : `"${confirm.doc.title ?? "This file"}" will be permanently removed from your documents.`
          : confirm.doc.source_type === "manual_input"
          ? "Processing will stop. Your profile record stays so you can process it again later."
          : "Processing will stop. The file stays so you can delete or reprocess it later."
      }
    >
      <View style={modalStyles.btnRow}>
        <Pressable
          style={({ pressed }) => [modalStyles.btnSecondary, pressed && { opacity: 0.75 }]}
          onPress={onClose}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Keep"
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
          accessible
          accessibilityRole="button"
          accessibilityLabel={isDelete ? "Remove permanently" : "Stop processing"}
        >
          <AppText style={modalStyles.btnPrimaryText}>
            {isDelete ? "Remove permanently" : "Stop processing"}
          </AppText>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

// ─── Document card ─────────────────────────────────────────────────────────────

function DocCard({
  doc,
  anim,
  onDelete,
  onCancel,
  isStopping,
  stageInfo,
}: {
  doc: DocRow;
  anim: DocAnim;
  onDelete: () => void;
  onCancel: () => void;
  isStopping?: boolean;
  /** Live stage info from the worker via ai_jobs realtime. Undefined until the
   *  first stage update arrives (or for cards loaded from a stale job). */
  stageInfo?: StageInfo;
}) {
  const { cardStyles } = useStyles();
  const { colors } = useTheme();
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

  const fileType =
    isManual ? "Manual input" :
    isAudio ? "Voice note" :
    doc.source_type === "scanned_pdf" ? "Scan" :
    doc.source_type === "image_gallery" ? "Legacy photo" :
    doc.source_type === "image_camera" ? "Legacy scan" :
    "PDF";

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

        {/* Processing / stopping progress.
         *  Real progress bar + worker stage label when stageInfo is available
         *  (ai_jobs realtime has fired at least once); otherwise fall back to
         *  the indeterminate ShimmerBar + rotating placeholder messages. */}
        {(st === "processing" || st === "stopping") ? (
          <View style={cardStyles.progressBlock}>
            {stageInfo && st !== "stopping" ? (
              <ProgressBar percent={stageInfo.percent} />
            ) : (
              <ShimmerBar stopping={st === "stopping"} />
            )}
            <AppText style={[cardStyles.processingMsg, st === "stopping" && cardStyles.stoppingMsg]}>
              {st === "stopping"
                ? processingMsg
                : (stageInfo ? `${stageInfo.label}…` : processingMsg)}
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
              accessible
              accessibilityRole="button"
              accessibilityLabel="Stop processing"
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
              accessible
              accessibilityRole="button"
              accessibilityLabel="Remove document"
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


// ─── Main component ────────────────────────────────────────────────────────────

function sectionLabel(status: string) {
  if (status === "uploaded")   return "Ready to process";
  if (status === "processing") return "Processing";
  if (status === "failed")     return "Failed";
  return "Other";
}

const DOC_PAGE_SIZE = 20;

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
  const { listStyles } = useStyles();
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [records, setRecords] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { mode: "delete" | "cancel"; doc: DocRow }>(null);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Per-doc job stage info, populated by the ai_jobs realtime subscription.
  // Keyed by document_id so each card can display its own progress bar.
  const [jobStage, setJobStage] = useState<Map<string, StageInfo>>(new Map());

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
  const onStatusChangeRef = useRef(onStatusChange);
  const deleteInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => { docsRef.current = docs; }, [docs]);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  const getAnim = useCallback((id: string, fadeIn = false): DocAnim => {
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
  }, []);

  const animateOut = useCallback((
    id: string,
    opts: { kind?: "processed" | "delete"; speed?: "fast" | "normal" } = {},
    onDone: () => void
  ) => {
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
  }, [getAnim]);

  // Resolve userId once
  const { user } = useSession();
  useEffect(() => {
    setUserId(user?.id ?? null);
  }, [user?.id]);

  // Processed "Your records" list. Refetched on load AND on every poll tick so it
  // reflects detach / re-run / a doc finishing processing without a manual refresh.
  const refreshRecords = useCallback(async () => {
    if (!userId) return;
    try {
      const rec = await listDocuments(`?status=processed&offset=0&limit=50&ordering=-created_at`);
      setRecords(((rec.results ?? []) as DocRow[]).filter((d) => d.source_type !== "manual_input"));
    } catch {
      // Silent — records are supplementary; the active list surfaces errors.
    }
  }, [userId]);

  // Initial fetch (paginated)
  const fetchDocs = useCallback(async (offset: number, append: boolean) => {
    if (!userId) return;
    try {
      const result = await listDocuments(
        `?exclude_status=processed&offset=${offset}&limit=${DOC_PAGE_SIZE}&ordering=-created_at`
      );

      const rows = (result.results ?? []) as DocRow[];
      setHasMore(rows.length === DOC_PAGE_SIZE);

      if (append) {
        setDocs((prev) => [...prev, ...rows]);
      } else {
        setDocs(rows);
        await refreshRecords();
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load documents.");
    } finally {
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [userId, refreshRecords]);

  useEffect(() => {
    if (!userId) return;
    setError(null);
    setHasMore(true);
    animsRef.current.clear();
    animatingOutRef.current.clear();
    fetchDocs(0, false);
  }, [refreshKey, userId, fetchDocs]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    fetchDocs(docs.length, true);
  }, [loadingMore, hasMore, docs.length, fetchDocs]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setHasMore(true);
    animsRef.current.clear();
    animatingOutRef.current.clear();
    fetchDocs(0, false);
  }, [fetchDocs]);

  // Polling for document status updates (replaces realtime subscription)
  useEffect(() => {
    if (!userId) return;

    const interval = setInterval(async () => {
      try {
        const result = await listDocuments(
          `?exclude_status=processed&offset=0&limit=100&ordering=-created_at`
        );
        const updated = (result.results ?? []) as DocRow[];

        // Process updates and inserts
        const updatedMap = new Map(updated.map((d) => [d.id, d]));
        const currentMap = new Map(docs.map((d) => [d.id, d]));

        setDocs((prev) => {
          let changed = false;
          const next: DocRow[] = [];

          // Update or remove existing docs
          for (const d of prev) {
            const newData = updatedMap.get(d.id);
            if (!newData) {
              // Doc was deleted or processed
              if (d.status !== "processed") {
                changed = true;
              }
              continue;
            }
            if (newData.status === "processed") {
              // Process completed
              getAnim(newData.id);
              animateOut(newData.id, { kind: "processed", speed: "normal" }, () => {
                animsRef.current.delete(newData.id);
              });
              changed = true;
              continue;
            }
            if (JSON.stringify(d) !== JSON.stringify(newData)) {
              changed = true;
              if (newData.status === "uploaded") {
                setStoppingIds((prev) => { const s = new Set(prev); s.delete(newData.id); return s; });
              }
            }
            next.push(newData);
            updatedMap.delete(d.id);
          }

          // Add new docs
          for (const [id, newDoc] of updatedMap) {
            if (newDoc.status !== "processed") {
              changed = true;
              getAnim(newDoc.id, true);
              next.unshift(newDoc);
            }
          }

          if (changed) {
            onStatusChangeRef.current?.();
          }
          return changed ? next : prev;
        });
        // Keep "Your records" current as docs finish processing or are detached/
        // re-run from the detail screen.
        await refreshRecords();
      } catch (e) {
        // Silent fail on polling
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [userId, getAnim, animateOut, refreshRecords]);

  // Polling for ai_jobs stage (handled in next effect)

  // Polling for ai_jobs stage — runs only while at least one doc is
  // in 'processing'. Polling ensures the bar advances.
  const hasProcessingDocs = docs.some((d) => (d.status ?? "") === "processing");
  useEffect(() => {
    if (!userId || !hasProcessingDocs) return;

    const tick = async () => {
      try {
        const result = await listJobs(`?status__in=queued,running&limit=100`);
        const data = result.results ?? [];

        if (!data || data.length === 0) return;

        setJobStage((prev) => {
          const next = new Map(prev);
          for (const job of data) {
            const stage = String((job as any).stage ?? "");
            const info = STAGE_INFO[stage];
            if (!info) continue;
            const docIds: string[] = Array.isArray((job as any).document_ids)
              ? ((job as any).document_ids as string[])
              : [];
            const progress = (job as any).progress;
            const currentDocId: string | null =
              progress && typeof progress === "object" ? (progress.currentDocId ?? null) : null;
            if (currentDocId) {
              next.set(currentDocId, info);
            } else {
              for (const id of docIds) next.set(id, info);
            }
          }
          return next;
        });
      } catch (e) {
        // Silent fail on polling
      }
    };

    // Tick once immediately so the bar updates without waiting a full interval.
    tick();
    const interval = setInterval(tick, 1500);
    return () => clearInterval(interval);
  }, [userId, hasProcessingDocs]);

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



  const rows: Row[] = useMemo(() => {
    // Dedupe by id. Race between the realtime INSERT subscription and the
    // post-upload refetch (or strict-mode-induced double subscriptions in dev)
    // can occasionally leave the same doc twice in local state, which would
    // produce duplicate FlatList keys. Map.set keeps the most recent entry.
    const uniqueDocs = Array.from(
      new Map(docs.map((d) => [d.id, d])).values(),
    );

    const uploaded   = uniqueDocs.filter((d) => (d.status ?? "") === "uploaded");
    const processing = uniqueDocs.filter((d) => (d.status ?? "") === "processing");
    const failed     = uniqueDocs.filter((d) => (d.status ?? "") === "failed");
    const other      = uniqueDocs.filter((d) => !["uploaded", "processing", "failed"].includes(d.status ?? ""));

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
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
        }
        ListHeaderComponent={
          header ? (
            <View style={listStyles.headerWrap}>{header}</View>
          ) : null
        }
        ListFooterComponent={
          <>
            {loadingMore ? (
              <View style={listStyles.loadMoreWrap}>
                <ActivityIndicator color={colors.teal} size="small" />
              </View>
            ) : null}
            {records.length > 0 ? (
              <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
                <SectionHeader label="Your records" />
                {records.map((d) => (
                  <Pressable key={`rec-${d.id}`} onPress={() => navigation.navigate("DocumentDetail", { id: d.id, title: d.title ?? undefined })}>
                    <View style={cardStylesRecord(colors)}>
                      <AppText style={{ color: colors.text, fontWeight: typescale.weight.semibold }} numberOfLines={1}>
                        {d.title ?? "(untitled)"}
                      </AppText>
                      <AppText style={{ color: colors.muted, fontSize: typescale.size.xs }}>
                        {new Date(d.created_at).toLocaleDateString()} · {d.detached_at ? "Results removed" : "Tap to review"}
                      </AppText>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {footer ? (
              <View style={{ marginTop: spacing.sm }}>{footer}</View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <View style={listStyles.empty}>
            <Ionicons name="folder-open-outline" size={36} color={colors.muted} />
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
              stageInfo={jobStage.get(d.id)}
            />
          );
        }}
      />
    </View>
  );
}

function cardStylesRecord(c: any) {
  return { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
           padding: spacing.md, gap: 3 } as const;
}

const useStyles = createStyles((c) => ({
  shimmerStyles: StyleSheet.create({
    track: {
      height: 3,
      borderRadius: 2,
      backgroundColor: c.border,
      overflow: "hidden",
      marginTop: spacing.sm,
    },
    highlight: {
      width: 90,
      height: 3,
      borderRadius: 2,
      backgroundColor: c.teal,
    },
    highlightStopping: {
      backgroundColor: c.muted,
    },
  }),

  badgeStyles: StyleSheet.create({
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
  }),

  fileIconStyles: StyleSheet.create({
    wrap: {
      width: 40,
      height: 44,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    pdfWrap:     { backgroundColor: c.dangerSoft },
    audioWrap:   { backgroundColor: c.tealSoft },
    profileWrap: { backgroundColor: c.bgSecondary, borderWidth: 1, borderColor: c.tealBorder },
    imageWrap:   { backgroundColor: c.blueSoft },
    scanWrap:    { backgroundColor: c.teal },
    label: {
      fontSize: 10,
      fontWeight: typescale.weight.black,
      letterSpacing: 0.5,
    },
    pdfLabel:     { color: c.danger },
    audioLabel:   { color: c.teal },
    profileLabel: { color: c.teal },
    imageLabel:   { color: c.blue },
    scanLabel:    { color: "#fff" },
  }),

  sectionStyles: StyleSheet.create({
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
      backgroundColor: c.teal,
    },
    label: {
      fontSize: typescale.size.xs,
      fontWeight: typescale.weight.bold,
      color: c.muted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
  }),

  modalStyles: StyleSheet.create({
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
      backgroundColor: c.bgSecondary,
      borderWidth: 1,
      borderColor: c.border,
    },
    btnSecondaryText: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.semibold,
      color: c.textSub,
    },
    btnPrimary: {
      flex: 1.4,
      height: 46,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDanger: { backgroundColor: c.danger },
    btnOrange: { backgroundColor: c.warning },
    btnPrimaryText: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.bold,
      color: "#fff",
    },
  }),

  cardStyles: StyleSheet.create({
    wrapper: {
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
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
      color: c.text,
      lineHeight: typescale.size.base * typescale.lineHeight.normal,
    },
    meta: {
      fontSize: typescale.size.xs,
      color: c.muted,
    },

    // Processing
    progressBlock: {
      gap: spacing.xxs,
    },
    processingMsg: {
      fontSize: typescale.size.xs,
      color: c.teal,
      fontWeight: typescale.weight.medium,
      marginTop: 3,
    },
    stoppingMsg: {
      color: c.muted,
    },

    // Error
    errorBlock: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.xs,
      backgroundColor: c.dangerSoft,
      borderRadius: radius.sm,
      padding: spacing.sm,
      marginTop: spacing.xxs,
    },
    errorDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.danger,
      marginTop: 4,
    },
    errorText: {
      flex: 1,
      fontSize: typescale.size.xs,
      color: c.danger,
      lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    },

    // Footer actions
    footer: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: spacing.xxs,
      borderTopWidth: 1,
      borderTopColor: c.borderLight,
      paddingTop: spacing.xs,
    },
    actionBtn: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    cancelBtn: {
      borderColor: c.tealBorder,
      backgroundColor: c.tealSoft,
    },
    cancelBtnStopping: {
      borderColor: c.border,
      backgroundColor: c.bgSecondary,
      opacity: 0.7,
    },
    cancelBtnText: {
      fontSize: typescale.size.xs,
      fontWeight: typescale.weight.semibold,
      color: c.teal,
    },
    cancelBtnTextStopping: {
      color: c.muted,
    },
    removeBtn: {
      borderColor: c.border,
      backgroundColor: c.bgSecondary,
    },
    removeBtnText: {
      fontSize: typescale.size.xs,
      fontWeight: typescale.weight.semibold,
      color: c.muted,
    },

    // Flash overlay
    flash: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.lg,
    },
  }),

  listStyles: StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      flexGrow: 1,
    },
    loadMoreWrap: {
      paddingVertical: spacing.md,
      alignItems: "center",
    },
    headerWrap: {
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    errorBanner: {
      backgroundColor: c.dangerSoft,
      borderBottomWidth: 1,
      borderBottomColor: c.dangerBorder,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    errorBannerText: {
      fontSize: typescale.size.sm,
      color: c.danger,
      fontWeight: typescale.weight.medium,
    },
    empty: {
      paddingVertical: spacing.xxl,
      alignItems: "center",
      gap: spacing.sm,
    },
    emptyTitle: {
      fontSize: typescale.size.base,
      fontWeight: typescale.weight.semibold,
      color: c.text,
    },
    emptyBody: {
      fontSize: typescale.size.sm,
      color: c.muted,
      textAlign: "center",
      lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
      maxWidth: 260,
    },
  }),
}));
