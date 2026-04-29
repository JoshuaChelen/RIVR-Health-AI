import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

// expo-print, expo-file-system, and expo-image-manipulator are used on native only.
// On web, PDF compilation goes through @cantoo/pdf-lib via scanPdf.web.ts.
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { supabase } from "../../../lib/supabase";
import {
  uploadAndInsertDocument,
  uploadBytesAndInsertDocument,
  checkDuplicateDocument,
} from "../../../lib/documents";
import { compileScanPagesForWeb } from "../../../lib/scanPdf";
import { AppText } from "../Primitives/AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { spacing, radius, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";


// ─── Types ────────────────────────────────────────────────────────────────────

// width and height are stored from the ImagePicker result so the native
// prepareNativePage helper can decide whether resizing is needed without
// an extra image-info round-trip.
type ScanPage = { id: string; uri: string; mimeType: string; width: number; height: number };

type Props = { onUploaded?: () => void };

const MAX_SCAN_PAGES  = 20;
// Shared across native (expo-image-manipulator) and web (canvas in scanPdf.web.ts).
const MAX_SCAN_WIDTH  = 1800;
const SCAN_COMPRESS   = 0.82;

let _pageIdSeed = 0;
function newId() { return `sp-${Date.now()}-${++_pageIdSeed}`; }

// On web, expo-image-picker returns blob: URIs created via URL.createObjectURL().
// These URLs hold the raw image bytes in the browser's blob store until
// URL.revokeObjectURL() is called. We must revoke them when we are done
// displaying or processing each page to prevent accumulating hundreds of
// megabytes of image data in memory.
//
// Safe revoke points:
//   - When a page is removed from the session
//   - When pages exceed the cap and are discarded in handleAddLibrary
//   - After a successful upload (pages are no longer displayed)
//   - When the modal is closed without uploading
//
// Note: browsers cache decoded image bitmaps, so images already rendered
// continue to display after revocation — there is no visual glitch.
// We never revoke on failure so the user can retry without re-adding pages.
function revokeScanPageUrls(pages: ScanPage[]): void {
  if (Platform.OS !== "web") return;
  for (const page of pages) {
    // revokeObjectURL silently ignores non-blob URIs (e.g. file://, data:)
    try { URL.revokeObjectURL(page.uri); } catch { /* ignore */ }
  }
}

// Reads a local image URI as a base64 string.
// On native: expo-file-system (fast, no memory copy via JS bridge).
// On web:    fetch + FileReader (works for blob: URIs from ImagePicker).
// Used only on native for the expo-print HTML compilation path.
async function readUriAsBase64(uri: string): Promise<string> {
  if (Platform.OS !== "web") {
    return FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  }
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to read image (${res.status})`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned unexpected type"));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.readAsDataURL(blob);
  });
}


// Prepares one scan page for embedding in the expo-print HTML template.
//
// If the image is wider than MAX_SCAN_WIDTH it is resized and re-encoded as
// JPEG using expo-image-manipulator (runs in native code — no JS-bridge pixel
// copy). The temp file produced by the manipulator is deleted in the finally
// block whether the encode succeeds or fails.
//
// If the image is already within the width limit (or width is unknown) the
// original URI is read directly — no extra encoding step.
//
// Only called in the native (iOS/Android) path of handleUploadScan.
async function prepareNativePage(
  page: ScanPage
): Promise<{ b64: string; mimeType: string }> {
  // page.width === 0 means the picker did not report dimensions — safe fallback.
  if (page.width === 0 || page.width <= MAX_SCAN_WIDTH) {
    return { b64: await readUriAsBase64(page.uri), mimeType: page.mimeType };
  }

  const resized = await manipulateAsync(
    page.uri,
    [{ resize: { width: MAX_SCAN_WIDTH } }],
    { compress: SCAN_COMPRESS, format: SaveFormat.JPEG }
  );

  try {
    return { b64: await readUriAsBase64(resized.uri), mimeType: "image/jpeg" };
  } finally {
    FileSystem.deleteAsync(resized.uri, { idempotent: true }).catch(() => {});
  }
}

// ─── Stacked deck preview ─────────────────────────────────────────────────────

const DECK_W = 96;
const DECK_H = 132; // ≈ A4 portrait ratio

const DECK_OFFSETS = [
  { rotate: "-7deg",   tx: -11, ty:  9, opacity: 0.65 },
  { rotate: "-3.5deg", tx:  -5, ty:  4, opacity: 0.82 },
  { rotate:  "0deg",   tx:   0, ty:  0, opacity: 1    },
] as const;

function PageDeck({ pages }: { pages: ScanPage[] }) {
  const { deckStyles } = useStyles();
  if (!pages.length) return null;
  const visible = pages.slice(-3);
  const offsets = DECK_OFFSETS.slice(3 - visible.length);
  return (
    <View style={deckStyles.container}>
      {visible.map((page, i) => {
        const { rotate, tx, ty, opacity } = offsets[i];
        const isFront = i === visible.length - 1;
        return (
          <View
            key={page.id}
            style={[
              deckStyles.card,
              isFront && deckStyles.cardFront,
              { zIndex: i + 1, opacity, transform: [{ rotate }, { translateX: tx }, { translateY: ty }] },
            ]}
          >
            <Image source={{ uri: page.uri }} style={deckStyles.img} resizeMode="cover" accessibilityLabel="Scanned page" />
          </View>
        );
      })}
    </View>
  );
}



// ─── Single page thumbnail ─────────────────────────────────────────────────────

const THUMB_W = 68;
const THUMB_H = 94;

function PageThumb({
  page,
  index,
  total,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: {
  page: ScanPage;
  index: number;
  total: number;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const { thumbStyles } = useStyles();
  const { colors } = useTheme();
  return (
    <View style={thumbStyles.wrap}>
      <View style={thumbStyles.frame}>
        <Image source={{ uri: page.uri }} style={thumbStyles.img} resizeMode="cover" accessibilityLabel="Scanned page" />

        <Pressable
          onPress={onRemove}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Remove page"
          style={({ pressed }) => [thumbStyles.removeBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Ionicons name="close" size={14} color="#fff" />
        </Pressable>

        <View style={thumbStyles.badge}>
          <AppText style={thumbStyles.badgeText}>{index + 1}</AppText>
        </View>
      </View>

      <View style={thumbStyles.arrowRow}>
        <Pressable
          onPress={onMoveLeft}
          disabled={index === 0}
          style={({ pressed }) => [
            thumbStyles.arrowBtn,
            index === 0 && thumbStyles.arrowBtnOff,
            pressed && index !== 0 && { opacity: 0.6 },
          ]}
          hitSlop={6}
        >
          <Ionicons name="chevron-back" size={14} color={colors.textSub} />
        </Pressable>

        <Pressable
          onPress={onMoveRight}
          disabled={index === total - 1}
          style={({ pressed }) => [
            thumbStyles.arrowBtn,
            index === total - 1 && thumbStyles.arrowBtnOff,
            pressed && index !== total - 1 && { opacity: 0.6 },
          ]}
          hitSlop={6}
        >
          <Ionicons name="chevron-forward" size={14} color={colors.textSub} />
        </Pressable>
      </View>
    </View>
  );
}



// ─── Scan session modal ────────────────────────────────────────────────────────

function ScanModal({
  pages,
  busy,
  status,
  isError,
  onAddCamera,
  onAddLibrary,
  onRemovePage,
  onMovePage,
  onUpload,
  onClose,
}: {
  pages: ScanPage[];
  busy: boolean;
  status: string | null;
  isError: boolean;
  onAddCamera: () => void;
  onAddLibrary: () => void;
  onRemovePage: (id: string) => void;
  onMovePage: (id: string, dir: "left" | "right") => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const { modalStyles } = useStyles();
  const { colors } = useTheme();
  // On web, camera support varies by browser/device. Label accordingly.
  const cameraLabel = Platform.OS === "web"
    ? (pages.length === 0 ? "Capture Photo" : "Add Photo")
    : (pages.length === 0 ? "Take Photo"    : "Add Page");

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={modalStyles.root}>
        {/* ── Header ── */}
        <View style={modalStyles.header}>
          <View style={modalStyles.headerLeft}>
            <AppText style={modalStyles.title}>Scan Document</AppText>
            {pages.length > 0 && (
              <View style={modalStyles.countPill}>
                <AppText style={modalStyles.countText}>
                  {pages.length} {pages.length === 1 ? "page" : "pages"}
                </AppText>
              </View>
            )}
          </View>

          <Pressable
            onPress={onClose}
            disabled={busy}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [modalStyles.closeBtn, pressed && { opacity: 0.6 }]}
            hitSlop={10}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>

        {/* ── Scrollable body ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={modalStyles.body}
          showsVerticalScrollIndicator={false}
        >
          {pages.length > 0 ? (
            <PageDeck pages={pages} />
          ) : (
            <View style={modalStyles.emptyDeck}>
              <View style={modalStyles.emptyDeckRect} />
              <AppText style={modalStyles.emptyDeckLabel}>No pages yet</AppText>
            </View>
          )}

          {pages.length > 0 && (
            <AppText style={modalStyles.deckCaption}>
              {pages.length === 1
                ? "Add more pages or upload when done."
                : "Tap ← → to reorder · × to remove a page"}
            </AppText>
          )}

          {pages.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={modalStyles.thumbStrip}
            >
              {pages.map((page, i) => (
                <PageThumb
                  key={page.id}
                  page={page}
                  index={i}
                  total={pages.length}
                  onRemove={() => onRemovePage(page.id)}
                  onMoveLeft={() => onMovePage(page.id, "left")}
                  onMoveRight={() => onMovePage(page.id, "right")}
                />
              ))}
            </ScrollView>
          )}

          {/* Add page buttons */}
          <View style={modalStyles.addRow}>
            <Pressable
              onPress={onAddCamera}
              disabled={busy}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={({ pressed }) => [
                modalStyles.addBtn,
                pressed && !busy && { opacity: 0.75 },
                busy && modalStyles.addBtnDisabled,
              ]}
            >
              <Ionicons name="camera-outline" size={18} color={colors.textSub} />
              <AppText style={modalStyles.addBtnLabel}>{cameraLabel}</AppText>
            </Pressable>

            <Pressable
              onPress={onAddLibrary}
              disabled={busy}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
              style={({ pressed }) => [
                modalStyles.addBtn,
                pressed && !busy && { opacity: 0.75 },
                busy && modalStyles.addBtnDisabled,
              ]}
            >
              <Ionicons name="images-outline" size={18} color={colors.textSub} />
              <AppText style={modalStyles.addBtnLabel}>From Library</AppText>
            </Pressable>
          </View>
        </ScrollView>

        {/* ── Footer ── */}
        <View style={modalStyles.footer}>
          {status ? (
            <AppText style={[modalStyles.statusText, isError && modalStyles.statusError]}>
              {status}
            </AppText>
          ) : null}

          <Pressable
            onPress={onUpload}
            disabled={busy || pages.length === 0}
            style={({ pressed }) => [
              modalStyles.uploadBtn,
              (busy || pages.length === 0) && modalStyles.uploadBtnDisabled,
              pressed && !busy && pages.length > 0 && { opacity: 0.88 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" accessibilityLabel="Uploading" style={{ marginRight: 6 }} />
            ) : null}
            <AppText style={modalStyles.uploadBtnText}>
              {busy
                ? (status ?? "Working…")
                : pages.length === 0
                ? "Add pages to upload"
                : `Upload PDF · ${pages.length} page${pages.length === 1 ? "" : "s"}`}
            </AppText>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function UploadFile({ onUploaded }: Props) {
  const { cardStyles } = useStyles();
  // PDF upload state
  const [pdfBusy,   setPdfBusy]   = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [pdfError,  setPdfError]  = useState(false);

  // Scan session state
  const [scanOpen,   setScanOpen]   = useState(false);
  const [scanPages,  setScanPages]  = useState<ScanPage[]>([]);
  const [scanBusy,   setScanBusy]   = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanError,  setScanError]  = useState(false);

  // Duplicate-detection prompt state. handlePdf awaits a Promise whose
  // resolve() is stashed here; the modal calls it with true / false based on
  // the user's choice and then setDuplicateConfirm(null) closes the modal.
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    fileName: string;
    dupDate: string;
    resolve: (proceed: boolean) => void;
  } | null>(null);

  // ── PDF upload ────────────────────────────────────────────────────────────────
  // expo-document-picker opens a native file picker on iOS/Android and a
  // browser file input on web — no platform split needed here.

  async function handlePdf() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;

    const assets = picked.assets ?? [];
    if (!assets.length) return;

    setPdfBusy(true);
    setPdfError(false);
    setPdfStatus("Checking auth…");

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error("Not signed in");

      let uploaded = 0;

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (!asset?.uri) continue;

        const fileName = asset.name ?? `document_${Date.now()}.pdf`;
        const fileSize = typeof asset.size === "number" ? asset.size : 0;

        // Duplicate check (skip if size is unknown). Uses the in-app
        // DuplicateConfirmModal so the prompt is styled consistently and works
        // on web (Alert.alert renders nothing on web, leaving the upload hung).
        if (fileSize > 0) {
          const dup = await checkDuplicateDocument(user.id, fileName, fileSize);
          if (dup) {
            const dupDate = new Date(dup.created_at).toLocaleDateString(undefined, {
              month: "short", day: "numeric", year: "numeric",
            });
            const proceed = await new Promise<boolean>((resolve) => {
              setDuplicateConfirm({ fileName, dupDate, resolve });
            });
            if (!proceed) continue;
          }
        }

        setPdfStatus(`Uploading ${i + 1} of ${assets.length}…`);
        await uploadAndInsertDocument({
          userId:     user.id,
          uri:        asset.uri,
          fileName,
          mimeType:   asset.mimeType ?? "application/pdf",
          sourceType: "pdf",
        });
        uploaded += 1;
      }

      if (uploaded > 0) {
        setPdfStatus(`${uploaded} file${uploaded === 1 ? "" : "s"} ready to process.`);
        onUploaded?.();
      } else {
        // Every picked file was skipped (e.g. user cancelled the duplicate
        // prompt). Don't show a misleading "ready to process" message.
        setPdfStatus(null);
      }
    } catch (e: any) {
      setPdfStatus(e?.message ?? String(e));
      setPdfError(true);
    } finally {
      setPdfBusy(false);
    }
  }

  // ── Scan helpers ──────────────────────────────────────────────────────────────

  async function takeCameraPhoto(): Promise<ScanPage | null> {
    // On native, request the permission explicitly so we can show a clear
    // message if it was denied before. On web, the browser manages its own
    // camera permission dialog when the camera is launched — requesting ahead
    // of time is a no-op and may throw in some browsers.
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Camera access needed",
          "Allow camera access in your device settings to scan documents."
        );
        return null;
      }
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: "images",
        // 0.75 keeps the intermediate file small before the native resize step.
        quality: 0.75,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return null;
      const asset = result.assets[0];
      return {
        id: newId(),
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        width:  asset.width  ?? 0,
        height: asset.height ?? 0,
      };
    } catch (e: any) {
      // On web, launchCameraAsync throws if the browser can't access a camera
      // (e.g. no camera connected on desktop, or permission denied in browser).
      if (Platform.OS === "web") {
        Alert.alert(
          "Camera unavailable",
          "Your browser could not access a camera. Use \"From Library\" to select images instead."
        );
      }
      return null;
    }
  }

  async function pickLibraryPhotos(): Promise<ScanPage[]> {
    // On native, show a clear denied message. On web, the browser file input
    // doesn't require a separate permission prompt — skip the request.
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Photo library access needed",
          "Allow photo library access in your device settings."
        );
        return [];
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsMultipleSelection: true,
      // 0.75 keeps intermediate files small; prepareNativePage re-encodes
      // large images anyway, so there is no meaningful quality benefit to
      // a higher value here.
      quality: 0.75,
      exif: false,
    });
    if (result.canceled || !result.assets?.length) return [];
    return result.assets
      .filter((a) => !!a.uri)
      .map((a) => ({
        id: newId(),
        uri: a.uri,
        mimeType: a.mimeType ?? "image/jpeg",
        width:  a.width  ?? 0,
        height: a.height ?? 0,
      }));
  }

  // On native: auto-launch camera so the first page is captured immediately,
  //            then open the session modal.
  // On web:    open the modal directly — the user can choose camera or library
  //            inside the modal. Auto-launching the browser camera without a
  //            user gesture inside the modal feels abrupt on desktop.
  async function handleStartScan() {
    if (Platform.OS === "web") {
      setScanPages([]);
      setScanStatus(null);
      setScanError(false);
      setScanOpen(true);
      return;
    }

    const page = await takeCameraPhoto();
    if (!page) return;
    setScanPages([page]);
    setScanStatus(null);
    setScanError(false);
    setScanOpen(true);
  }

  async function handleAddCamera() {
    if (scanPages.length >= MAX_SCAN_PAGES) {
      Alert.alert(
        "Page limit reached",
        `Scans are limited to ${MAX_SCAN_PAGES} pages. Upload this scan first, then start a new one.`
      );
      return;
    }
    const page = await takeCameraPhoto();
    if (!page) return;
    setScanPages((prev) => [...prev, page]);
  }

  async function handleAddLibrary() {
    if (scanPages.length >= MAX_SCAN_PAGES) {
      Alert.alert(
        "Page limit reached",
        `Scans are limited to ${MAX_SCAN_PAGES} pages. Upload this scan first, then start a new one.`
      );
      return;
    }
    const newPages = await pickLibraryPhotos();
    if (!newPages.length) return;
    const remaining = MAX_SCAN_PAGES - scanPages.length;
    const toAdd = newPages.slice(0, remaining);
    if (newPages.length > remaining) {
      // Revoke the blob URLs of pages we are not going to use before
      // discarding them — otherwise they leak in the browser's blob store.
      revokeScanPageUrls(newPages.slice(remaining));
      Alert.alert(
        "Page limit reached",
        `Added ${toAdd.length} of ${newPages.length} photos. Maximum is ${MAX_SCAN_PAGES} pages per scan.`
      );
    }
    setScanPages((prev) => [...prev, ...toAdd]);
  }

  function handleRemovePage(id: string) {
    const removed = scanPages.find((p) => p.id === id);
    const next = scanPages.filter((p) => p.id !== id);
    setScanPages(next);
    if (next.length === 0) setScanOpen(false);
    // Revoke the removed page's blob URL now that it is no longer displayed.
    if (removed) revokeScanPageUrls([removed]);
  }

  function handleMovePage(id: string, dir: "left" | "right") {
    setScanPages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      if (dir === "left"  && idx === 0)               return prev;
      if (dir === "right" && idx === prev.length - 1)  return prev;
      const next = [...prev];
      const swap = dir === "left" ? idx - 1 : idx + 1;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function handleUploadScan() {
    if (!scanPages.length) return;

    setScanBusy(true);
    setScanError(false);
    setScanStatus("Reading pages…");

    // Holds the expo-print temp file URI (native only). Cleaned up in finally.
    let pdfUri: string | null = null;

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error("Not signed in");

      const pageCount = scanPages.length;
      const fileName  = `scan_${Date.now()}.pdf`;
      const title     = `Scanned Document (${pageCount} page${pageCount === 1 ? "" : "s"})`;

      if (Platform.OS === "web") {
        // ── Web path ──────────────────────────────────────────────────────────
        // pdf-lib (via scanPdf.web.ts) compiles the images into PDF bytes
        // entirely in-memory. No temp file is written; bytes are uploaded
        // directly to Supabase Storage.
        setScanStatus("Compiling PDF…");
        const pdfBytes = await compileScanPagesForWeb(scanPages);

        setScanStatus("Uploading…");
        await uploadBytesAndInsertDocument({
          userId:     user.id,
          bytes:      pdfBytes,
          fileName,
          mimeType:   "application/pdf",
          sourceType: "scanned_pdf",
          title,
        });
      } else {
        // ── Native path (iOS + Android) ───────────────────────────────────────
        // Each page is resized (if > MAX_SCAN_WIDTH) and JPEG-encoded via the
        // native image manipulator before base64 encoding. Pages are processed
        // sequentially to keep peak memory low. The resulting base64 strings
        // and their effective MIME types are passed to expo-print as a single
        // HTML document which renders to a PDF file.
        setScanStatus("Preparing pages…");
        const preparedPages: Array<{ b64: string; mimeType: string }> = [];
        for (const page of scanPages) {
          const prepared = await prepareNativePage(page);
          preparedPages.push(prepared);
        }

        setScanStatus("Compiling PDF…");
        const pageHtml = preparedPages
          .map(
            ({ b64, mimeType }) =>
              `<div class="page"><img src="data:${mimeType};base64,${b64}" /></div>`
          )
          .join("\n");

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; }
  .page {
    width: 100%;
    min-height: 100vh;
    page-break-after: always;
    display: flex;
    align-items: center;
    justify-content: center;
    background: white;
    overflow: hidden;
  }
  .page:last-child { page-break-after: avoid; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; display: block; }
</style></head>
<body>${pageHtml}</body></html>`;

        const result = await Print.printToFileAsync({ html });
        pdfUri = result.uri;

        setScanStatus("Uploading…");
        await uploadAndInsertDocument({
          userId:     user.id,
          uri:        pdfUri,
          fileName,
          mimeType:   "application/pdf",
          sourceType: "scanned_pdf",
          title,
        });
      }

      // ── Success ──────────────────────────────────────────────────────────────
      // Revoke blob URLs before clearing state. Images are cached by the
      // browser so they continue to display during any close animation, but
      // the underlying memory is freed immediately.
      revokeScanPageUrls(scanPages);
      setScanOpen(false);
      setScanPages([]);
      setScanStatus(null);
      onUploaded?.();
    } catch (e: any) {
      setScanStatus(e?.message ?? String(e));
      setScanError(true);
    } finally {
      setScanBusy(false);
      // Delete the expo-print temp file if one was created (native only).
      // On web there is no temp file — pdfUri stays null.
      if (pdfUri) {
        FileSystem.deleteAsync(pdfUri, { idempotent: true }).catch(() => {});
      }
    }
  }

  function handleScanClose() {
    if (scanBusy) return;
    // Revoke all blob URLs before clearing state — the user is abandoning
    // this scan session and the images will no longer be displayed.
    revokeScanPageUrls(scanPages);
    setScanOpen(false);
    setScanPages([]);
    setScanStatus(null);
    setScanError(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Scan hint varies by platform so the copy matches what the user will see.
  const scanHint = Platform.OS === "web"
    ? "Select images — compiled into one PDF for upload"
    : "Take photos of each page — compiled into one PDF";

  return (
    <>
      <View style={cardStyles.card}>
        <ActionRow
          icon={<Ionicons name="document-text-outline" size={18} color="#fff" />}
          title={pdfBusy ? "Uploading…" : "Upload PDF"}
          hint="Select one or more PDF files from your device"
          onPress={handlePdf}
          disabled={pdfBusy}
        />

        {pdfStatus ? (
          <View style={cardStyles.pdfStatus}>
            <AppText style={[cardStyles.statusText, pdfError && cardStyles.statusError]}>
              {pdfStatus}
            </AppText>
          </View>
        ) : null}

        <View style={cardStyles.divider} />

        <ActionRow
          icon={<Ionicons name="camera-outline" size={18} color="#fff" />}
          title="Scan Document"
          hint={scanHint}
          onPress={handleStartScan}
          disabled={pdfBusy || scanBusy}
        />
      </View>

      {scanOpen && (
        <ScanModal
          pages={scanPages}
          busy={scanBusy}
          status={scanStatus}
          isError={scanError}
          onAddCamera={handleAddCamera}
          onAddLibrary={handleAddLibrary}
          onRemovePage={handleRemovePage}
          onMovePage={handleMovePage}
          onUpload={handleUploadScan}
          onClose={handleScanClose}
        />
      )}

      {duplicateConfirm ? (
        <DuplicateConfirmModal
          fileName={duplicateConfirm.fileName}
          dupDate={duplicateConfirm.dupDate}
          onCancel={() => {
            duplicateConfirm.resolve(false);
            setDuplicateConfirm(null);
          }}
          onConfirm={() => {
            duplicateConfirm.resolve(true);
            setDuplicateConfirm(null);
          }}
        />
      ) : null}
    </>
  );
}

// ─── Duplicate confirmation modal ─────────────────────────────────────────────
// Styled to match the ConfirmModal pattern in ListDocuments — translucent
// backdrop, bottom-anchored sheet with a teal accent bar, two buttons.

function DuplicateConfirmModal({
  fileName,
  dupDate,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  dupDate: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { duplicateModalStyles } = useStyles();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <Pressable style={duplicateModalStyles.backdrop} onPress={onCancel}>
        <Pressable style={duplicateModalStyles.sheet} onPress={() => {}}>
          <View style={duplicateModalStyles.accentBar} />
          <View style={duplicateModalStyles.body}>
            <AppText style={duplicateModalStyles.title}>Possible duplicate</AppText>
            <AppText style={duplicateModalStyles.message}>
              A document named "{fileName}" with the same file size was uploaded on {dupDate}.
            </AppText>
            <View style={duplicateModalStyles.btnRow}>
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={onCancel}
                style={({ pressed }) => [duplicateModalStyles.btnSecondary, pressed && { opacity: 0.75 }]}
              >
                <AppText style={duplicateModalStyles.btnSecondaryText}>Cancel</AppText>
              </Pressable>
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Upload anyway"
                onPress={onConfirm}
                style={({ pressed }) => [duplicateModalStyles.btnPrimary, pressed && { opacity: 0.85 }]}
              >
                <AppText style={duplicateModalStyles.btnPrimaryText}>Upload anyway</AppText>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


// ─── Action row ───────────────────────────────────────────────────────────────

function ActionRow({
  icon,
  title,
  hint,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { cardStyles } = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        cardStyles.row,
        pressed && !disabled && cardStyles.rowPressed,
        disabled && cardStyles.rowDisabled,
      ]}
    >
      <View style={cardStyles.iconCircle}>
        {icon}
      </View>
      <View style={cardStyles.textBlock}>
        <AppText style={cardStyles.rowTitle}>{title}</AppText>
        <AppText style={cardStyles.rowHint}>{hint}</AppText>
      </View>
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  deckStyles: StyleSheet.create({
    container: {
      width:  DECK_W + 28,
      height: DECK_H + 24,
      alignSelf: "center",
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    card: {
      position: "absolute",
      left: 14,
      top:  12,
      width:  DECK_W,
      height: DECK_H,
      borderRadius: radius.sm,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgSecondary,
      ...shadows.card,
    },
    cardFront: {
      borderColor: c.tealBorder,
      ...shadows.lg,
    },
    img: {
      width:  DECK_W,
      height: DECK_H,
    },
  }),

  thumbStyles: StyleSheet.create({
    wrap: {
      alignItems: "center",
      gap: spacing.xxs,
      marginRight: spacing.sm,
    },
    frame: {
      width:  THUMB_W,
      height: THUMB_H,
      borderRadius: radius.xs,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgSecondary,
    },
    img: { width: THUMB_W, height: THUMB_H },
    removeBtn: {
      position: "absolute",
      top: 3,
      right: 3,
      width:  20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "rgba(13,27,42,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    badge: {
      position: "absolute",
      bottom: 3,
      left: 3,
      backgroundColor: "rgba(13,27,42,0.6)",
      borderRadius: radius.xs,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    badgeText: { color: "#fff", fontSize: 9, fontWeight: "700" },
    arrowRow: { flexDirection: "row", gap: 4 },
    arrowBtn: {
      width: 28,
      height: 20,
      borderRadius: radius.xs,
      backgroundColor: c.bgSecondary,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    arrowBtnOff: { opacity: 0.25 },
  }),

  modalStyles: StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },

    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surface,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    title: {
      fontSize: typescale.size.lg,
      fontWeight: typescale.weight.bold,
      color: c.text,
    },
    countPill: {
      backgroundColor: c.tealSoft,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: c.tealBorder,
    },
    countText: {
      fontSize: typescale.size.xs,
      fontWeight: typescale.weight.semibold,
      color: c.teal,
    },
    closeBtn: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      backgroundColor: c.bgSecondary,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },

    body: { paddingBottom: spacing.lg },

    emptyDeck: {
      height: DECK_H + 40,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    emptyDeckRect: {
      width: DECK_W,
      height: DECK_H,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: c.border,
      backgroundColor: c.bgSecondary,
    },
    emptyDeckLabel: { fontSize: typescale.size.sm, color: c.subtle },

    deckCaption: {
      fontSize: typescale.size.xs,
      color: c.muted,
      textAlign: "center",
      marginBottom: spacing.md,
      paddingHorizontal: spacing.lg,
    },

    thumbStrip: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },

    addRow: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    addBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: c.border,
      ...shadows.xs,
    },
    addBtnDisabled: { opacity: 0.45 },

    addBtnLabel: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.medium,
      color: c.textSub,
    },

    footer: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
      gap: spacing.xs,
    },
    statusText: {
      fontSize: typescale.size.xs,
      color: c.teal,
      textAlign: "center",
      fontWeight: typescale.weight.medium,
    },
    statusError: { color: c.danger },
    uploadBtn: {
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: c.teal,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      ...shadows.card,
    },
    uploadBtnDisabled: { opacity: 0.4 },
    uploadBtnText: {
      fontSize: typescale.size.base,
      fontWeight: typescale.weight.bold,
      color: "#fff",
    },
  }),

  cardStyles: StyleSheet.create({
    card: {
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: c.tealBorder,
      borderRadius: radius.lg,
      backgroundColor: c.tealSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      ...shadows.xs,
    },
    divider: {
      height: 1,
      backgroundColor: c.tealBorder,
      opacity: 0.5,
      marginHorizontal: spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowPressed:  { opacity: 0.7 },
    rowDisabled: { opacity: 0.5 },
    iconCircle: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.teal,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    textBlock: { flex: 1, gap: 2 },
    rowTitle: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.semibold,
      color: c.teal,
    },
    rowHint: {
      fontSize: typescale.size.xs,
      color: c.teal,
      opacity: 0.75,
    },
    pdfStatus: {
      paddingBottom: spacing.xs,
      paddingLeft: 38 + spacing.md,
    },
    statusText: {
      fontSize: typescale.size.xs,
      color: c.teal,
      fontWeight: typescale.weight.medium,
    },
    statusError: { color: c.danger },
  }),

  // Duplicate-confirmation modal — mirrors the ConfirmModal style in
  // ListDocuments (translucent backdrop, bottom-anchored sheet with a teal
  // accent bar and two buttons) so the visual language stays consistent.
  duplicateModalStyles: StyleSheet.create({
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
      backgroundColor: c.surface,
      borderRadius: radius.xl,
      overflow: "hidden",
      ...shadows.lg,
    },
    accentBar: {
      height: 4,
      backgroundColor: c.teal,
    },
    body: {
      padding: spacing.lg,
      gap: spacing.sm,
    },
    title: {
      fontSize: typescale.size.lg,
      fontWeight: typescale.weight.bold,
      color: c.text,
    },
    message: {
      fontSize: typescale.size.sm,
      color: c.textSub,
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
      backgroundColor: c.teal,
    },
    btnPrimaryText: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.bold,
      color: "#fff",
    },
  }),
}));
