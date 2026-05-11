import React, { useState } from "react";
import {
  View,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../../lib/supabase";
import { captureException } from "../../lib/sentry";

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { ErrorBanner } from "../../components/ui/Primitives/ErrorBanner";
import { spacing, radius, shadows, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShareType = "full_summary" | "card_3x5" | "pre_visit_note" | "full_timeline";

type OptionDef = {
  type: ShareType;
  iconName: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  accentKey: "teal" | "blue" | "orange" | "green";
  accentSoftKey: "tealSoft" | "blueSoft" | "orangeSoft" | "greenSoft";
};

// ─── Option definitions ───────────────────────────────────────────────────────

const SHARE_OPTIONS: OptionDef[] = [
  {
    type: "full_summary",
    iconName: "sparkles-outline",
    title: "Full Summary",
    description:
      "Your AI-generated health analysis with SHIN score, overview, and complete findings.",
    accentKey: "teal",
    accentSoftKey: "tealSoft",
  },
  {
    type: "card_3x5",
    iconName: "reader-outline",
    title: "3x5 Card",
    description:
      "Critical health facts — blood type, medications, allergies — for quick provider reference.",
    accentKey: "blue",
    accentSoftKey: "blueSoft",
  },
  {
    type: "pre_visit_note",
    iconName: "medkit-outline",
    title: "Pre-Visit Note",
    description:
      "Selected timeline events formatted as a structured note for your upcoming appointment.",
    accentKey: "orange",
    accentSoftKey: "orangeSoft",
  },
  {
    type: "full_timeline",
    iconName: "calendar-outline",
    title: "Full Health Timeline",
    description:
      "Your complete medical history chronologically — all events, grouped by date, for provider review.",
    accentKey: "green",
    accentSoftKey: "greenSoft",
  },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ShareScreen() {
  const styles = useStyles();
  const { colors } = useTheme();

  const [selected, setSelected]       = useState<Set<ShareType>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError]   = useState<string | null>(null);
  const [shareUrl, setShareUrl]       = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);

  const toggle = (type: ShareType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (selected.size === 0) return;
    setModalVisible(true);
    setShareLoading(true);
    setShareError(null);
    setShareUrl(null);
    setCopied(false);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");

      const { data: pkg, error } = await supabase.functions.invoke(
        "create-share-package",
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: {
            shareTypes: Array.from(selected),
            expiresInMinutes: 1,
            maxViews: 2,
          },
        }
      );

      if (error) throw error;
      if (pkg?.shareUrl) setShareUrl(pkg.shareUrl);
      else throw new Error("No share URL returned");
    } catch (e: any) {
      captureException(e);
      setShareError(e?.message ?? "Failed to create share link.");
    } finally {
      setShareLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const closeModal = () => {
    setModalVisible(false);
    setShareLoading(false);
    setShareError(null);
    setShareUrl(null);
    setCopied(false);
  };

  const canGenerate = selected.size > 0;

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Page header ─────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerIconWrap}>
            <Ionicons name="share-social-outline" size={18} color={colors.teal} />
          </View>
          <View style={styles.headerText}>
            <AppText variant="h1" style={styles.title}>Share Health Records</AppText>
            <AppText style={styles.subtitle}>
              Generate a secure, time-limited link. No account required to view.
            </AppText>
          </View>
        </View>

        {/* ── Section label ───────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionAccent} />
          <AppText style={styles.sectionLabel}>CHOOSE WHAT TO SHARE</AppText>
        </View>

        {/* ── Option cards ────────────────────────────────────── */}
        {SHARE_OPTIONS.map((opt) => {
          const isSelected = selected.has(opt.type);
          return (
            <OptionCard
              key={opt.type}
              opt={opt}
              isSelected={isSelected}
              onPress={() => toggle(opt.type)}
            />
          );
        })}

        {/* ── Link settings row ───────────────────────────────── */}
        <View style={styles.settingsRow}>
          <View style={styles.settingChip}>
            <Ionicons name="timer-outline" size={14} color={colors.textSub} />
            <AppText style={styles.settingChipText}>Expires in 1 min</AppText>
          </View>
          <View style={styles.settingChip}>
            <Ionicons name="eye-outline" size={14} color={colors.textSub} />
            <AppText style={styles.settingChipText}>Max 2 views</AppText>
          </View>
        </View>

        {/* ── Security note ───────────────────────────────────── */}
        <View style={styles.securityNote}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSub} />
          <AppText style={styles.securityText}>
            Links are token-protected and expire automatically. Shared data is
            a read-only snapshot, not your live profile.
          </AppText>
        </View>

        {/* ── Generate button ─────────────────────────────────── */}
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={canGenerate ? `Generate secure link, ${selected.size} items selected` : "Select at least one option"}
          accessibilityState={{ disabled: !canGenerate }}
          onPress={handleGenerate}
          disabled={!canGenerate}
          style={({ pressed }) => [
            styles.generateBtn,
            !canGenerate && styles.generateBtnDisabled,
            pressed && canGenerate && styles.generateBtnPressed,
          ]}
        >
          <AppText
            style={[
              styles.generateBtnText,
              !canGenerate && styles.generateBtnTextDisabled,
            ]}
          >
            {canGenerate
              ? `Generate Secure Link · ${selected.size} item${selected.size === 1 ? "" : "s"}`
              : "Select at least one option"}
          </AppText>
        </Pressable>
      </ScrollView>

      {/* ── Result modal ──────────────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modal}>
          {/* Handle bar */}
          <View style={styles.modalHandle} />

          {/* Modal header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <AppText style={styles.modalTitle}>
                {shareLoading
                  ? "Creating link…"
                  : shareError
                  ? "Something went wrong"
                  : "Link ready"}
              </AppText>
              {!shareLoading && !shareError && shareUrl ? (
                <AppText style={styles.modalSubtitle}>
                  Expires in 1 min · Max 2 views
                </AppText>
              ) : null}
            </View>
            <Pressable
              onPress={closeModal}
              style={({ pressed }) => [
                styles.modalCloseBtn,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          </View>

          {/* ── Loading state ── */}
          {shareLoading ? (
            <View style={styles.modalCenter}>
              <View style={styles.loadingCard}>
                <ActivityIndicator color={colors.teal} size="large" accessibilityLabel="Creating share link" />
                <AppText style={styles.loadingTitle}>
                  Packaging your health data…
                </AppText>
                <AppText style={styles.loadingBody}>
                  We are creating an encrypted snapshot. This takes just a
                  moment.
                </AppText>
              </View>
            </View>
          ) : shareError ? (
            /* ── Error state ── */
            <View style={styles.modalCenter}>
              <View style={{ width: "100%", gap: spacing.md }}>
                <ErrorBanner
                  message="Something went wrong creating your share link"
                  onRetry={() => { setShareError(null); handleGenerate(); }}
                />
                <Pressable
                  onPress={closeModal}
                  style={({ pressed }) => [
                    styles.dismissBtn,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <AppText style={styles.dismissBtnText}>Dismiss</AppText>
                </Pressable>
              </View>
            </View>
          ) : shareUrl ? (
            /* ── Success state ── */
            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Success badge */}
              <View style={styles.successBadge}>
                <View style={styles.successDot} />
                <AppText style={styles.successBadgeText}>Secure link created</AppText>
              </View>

              {/* QR code */}
              <View style={styles.qrCard}>
                <QRCode
                  value={shareUrl}
                  size={180}
                  color={colors.text}
                  backgroundColor={colors.surface}
                />
              </View>

              {/* URL box */}
              <View style={styles.urlCard}>
                <AppText style={styles.urlLabel}>SHARE LINK</AppText>
                <AppText
                  style={styles.urlText}
                  numberOfLines={2}
                  ellipsizeMode="middle"
                >
                  {shareUrl}
                </AppText>
              </View>

              {/* Copy button */}
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={copied ? "Copied to clipboard" : "Copy link"}
                onPress={copyToClipboard}
                style={({ pressed }) => [
                  styles.copyBtn,
                  copied && styles.copyBtnSuccess,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={styles.copyBtnContent}>
                  {copied ? (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  ) : (
                    <Ionicons name="copy-outline" size={16} color="#fff" />
                  )}
                  <AppText style={styles.copyBtnText}>
                    {copied ? "Copied to clipboard" : "Copy Link"}
                  </AppText>
                </View>
              </Pressable>

              {/* What's included */}
              <View style={styles.includedBlock}>
                <AppText style={styles.includedLabel}>{"WHAT'S INCLUDED"}</AppText>
                {Array.from(selected).map((type) => {
                  const opt = SHARE_OPTIONS.find((o) => o.type === type)!;
                  const accent = colors[opt.accentKey];
                  const accentSoft = colors[opt.accentSoftKey];
                  return (
                    <View key={type} style={styles.includedRow}>
                      <View
                        style={[
                          styles.includedIconWrap,
                          { backgroundColor: accentSoft },
                        ]}
                      >
                        <Ionicons name={opt.iconName} size={14} color={accent} />
                      </View>
                      <AppText style={styles.includedText}>{opt.title}</AppText>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

// ─── OptionCard subcomponent ──────────────────────────────────────────────────

function OptionCard({
  opt,
  isSelected,
  onPress,
}: {
  opt: OptionDef;
  isSelected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const accent = colors[opt.accentKey];
  const accentSoft = colors[opt.accentSoftKey];

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${opt.title}, ${opt.description}`}
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.oc_card,
        isSelected && { borderColor: accent, borderWidth: 2 },
        pressed && styles.oc_pressed,
      ]}
    >
      {/* Left teal accent bar */}
      <View
        style={[
          styles.oc_accentBar,
          { backgroundColor: isSelected ? accent : colors.borderLight },
        ]}
      />

      <View style={styles.oc_body}>
        {/* Icon + title row */}
        <View style={styles.oc_topRow}>
          <View
            style={[
              styles.oc_iconWrap,
              {
                backgroundColor: isSelected
                  ? accentSoft
                  : colors.bgSecondary,
              },
            ]}
          >
            <Ionicons name={opt.iconName} size={18} color={accent} />
          </View>

          <View style={styles.oc_textBlock}>
            <AppText
              style={[styles.oc_title, isSelected && { color: accent }]}
            >
              {opt.title}
            </AppText>
            <AppText style={styles.oc_desc}>{opt.description}</AppText>
          </View>

          <View
            style={[
              styles.oc_checkBox,
              isSelected && {
                backgroundColor: accent,
                borderColor: accent,
              },
            ]}
          >
            {isSelected ? (
              <Ionicons name="checkmark" size={14} color="#fff" />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
  // ── OptionCard (oc) ─────────────────────────────────────────────────────
  oc_card: {
    flexDirection: "row",
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
    ...shadows.card,
  },
  oc_pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  oc_accentBar: {
    width: 4,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
  },
  oc_body: {
    flex: 1,
    padding: spacing.md,
  },
  oc_topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  oc_iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  oc_textBlock: {
    flex: 1,
    gap: 3,
  },
  oc_title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  oc_desc: {
    fontSize: typescale.size.xs,
    color: c.muted,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
  oc_checkBox: {
    width: 24,
    height: 24,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "transparent",
  },

  // ── Main styles ─────────────────────────────────────────────────────────
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.md,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  headerIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: c.tealBorder,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: c.text,
  },
  subtitle: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Section label
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  sectionAccent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: c.teal,
  },
  copyBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // Settings chips
  settingsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  settingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: c.bgSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderWidth: 1,
    borderColor: c.border,
  },
  settingChipText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
  },

  // Security note
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    backgroundColor: c.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  securityText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: c.muted,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Generate button
  generateBtn: {
    height: 54,
    backgroundColor: c.teal,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.teal,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  generateBtnDisabled: {
    backgroundColor: c.bgSecondary,
    shadowOpacity: 0,
    elevation: 0,
    borderWidth: 1,
    borderColor: c.border,
  },
  generateBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  generateBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  generateBtnTextDisabled: {
    color: c.subtle,
  },

  // ── Modal ────────────────────────────────────────────────────────────────

  modal: {
    flex: 1,
    backgroundColor: c.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    alignSelf: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  modalHeaderText: {
    gap: 3,
  },
  modalTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  modalSubtitle: {
    fontSize: typescale.size.xs,
    color: c.muted,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.bgSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  modalCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },

  // Loading card
  loadingCard: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.xxl,
    width: "100%",
    ...shadows.card,
  },
  loadingTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
    textAlign: "center",
  },
  loadingBody: {
    fontSize: typescale.size.sm,
    color: c.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Error card
  errorCard: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.dangerBorder,
    padding: spacing.xxl,
    width: "100%",
  },
  errorTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  errorBody: {
    fontSize: typescale.size.sm,
    color: c.danger,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  dismissBtn: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: c.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  dismissBtnText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
  },

  // Success content
  modalContent: {
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: "center",
  },
  successBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.successBorder,
  },
  successDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.success,
  },
  successBadgeText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.success,
  },
  qrCard: {
    backgroundColor: c.surface,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    ...shadows.card,
  },
  urlCard: {
    backgroundColor: c.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    width: "100%",
    gap: 5,
  },
  urlLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  urlText: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
  },
  copyBtn: {
    width: "100%",
    height: 50,
    backgroundColor: c.teal,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  copyBtnSuccess: {
    backgroundColor: c.success,
    shadowColor: c.success,
  },
  copyBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  includedBlock: {
    width: "100%",
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  includedLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: spacing.xxs,
  },
  includedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  includedIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  includedText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.text,
  },
}));
