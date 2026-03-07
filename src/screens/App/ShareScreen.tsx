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

import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors, spacing, radius, shadows, typescale } from "../../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShareType = "full_summary" | "card_3x5" | "pre_visit_note" | "full_timeline";

type OptionDef = {
  type: ShareType;
  icon: string;
  title: string;
  description: string;
  accent: string;
  accentSoft: string;
};

// ─── Option definitions ───────────────────────────────────────────────────────

const SHARE_OPTIONS: OptionDef[] = [
  {
    type: "full_summary",
    icon: "✦",
    title: "Full Summary",
    description:
      "Your AI-generated health analysis with SHIN score, overview, and complete findings.",
    accent: colors.teal,
    accentSoft: colors.tealSoft,
  },
  {
    type: "card_3x5",
    icon: "📋",
    title: "3×5 Card",
    description:
      "Critical health facts — blood type, medications, allergies — for quick provider reference.",
    accent: colors.blue,
    accentSoft: colors.blueSoft,
  },
  {
    type: "pre_visit_note",
    icon: "🩺",
    title: "Pre-Visit Note",
    description:
      "Selected timeline events formatted as a structured note for your upcoming appointment.",
    accent: colors.orange,
    accentSoft: colors.orangeSoft,
  },
  {
    type: "full_timeline",
    icon: "📅",
    title: "Full Health Timeline",
    description:
      "Your complete medical history chronologically — all events, grouped by date, for provider review.",
    accent: colors.green,
    accentSoft: colors.greenSoft,
  },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ShareScreen() {
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
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Page header ─────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerIconWrap}>
            <AppText style={styles.headerIcon}>🔗</AppText>
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
            <AppText style={styles.settingChipText}>⏱  Expires in 1 min</AppText>
          </View>
          <View style={styles.settingChip}>
            <AppText style={styles.settingChipText}>👁  Max 2 views</AppText>
          </View>
        </View>

        {/* ── Security note ───────────────────────────────────── */}
        <View style={styles.securityNote}>
          <AppText style={styles.securityDot}>🔒</AppText>
          <AppText style={styles.securityText}>
            Links are token-protected and expire automatically. Shared data is
            a read-only snapshot, not your live profile.
          </AppText>
        </View>

        {/* ── Generate button ─────────────────────────────────── */}
        <Pressable
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
              <AppText style={styles.modalCloseBtnText}>✕</AppText>
            </Pressable>
          </View>

          {/* ── Loading state ── */}
          {shareLoading ? (
            <View style={styles.modalCenter}>
              <View style={styles.loadingCard}>
                <ActivityIndicator color={colors.teal} size="large" />
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
              <View style={styles.errorCard}>
                <AppText style={styles.errorIcon}>⚠️</AppText>
                <AppText style={styles.errorTitle}>Failed to create link</AppText>
                <AppText style={styles.errorBody}>{shareError}</AppText>
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
                onPress={copyToClipboard}
                style={({ pressed }) => [
                  styles.copyBtn,
                  copied && styles.copyBtnSuccess,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <AppText style={styles.copyBtnText}>
                  {copied ? "✓  Copied to clipboard" : "Copy Link"}
                </AppText>
              </Pressable>

              {/* What's included */}
              <View style={styles.includedBlock}>
                <AppText style={styles.includedLabel}>WHAT'S INCLUDED</AppText>
                {Array.from(selected).map((type) => {
                  const opt = SHARE_OPTIONS.find((o) => o.type === type)!;
                  return (
                    <View key={type} style={styles.includedRow}>
                      <View
                        style={[
                          styles.includedIconWrap,
                          { backgroundColor: opt.accentSoft },
                        ]}
                      >
                        <AppText style={styles.includedIcon}>{opt.icon}</AppText>
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
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        oc.card,
        isSelected && { borderColor: opt.accent, borderWidth: 2 },
        pressed && oc.pressed,
      ]}
    >
      {/* Left teal accent bar */}
      <View
        style={[
          oc.accentBar,
          { backgroundColor: isSelected ? opt.accent : colors.borderLight },
        ]}
      />

      <View style={oc.body}>
        {/* Icon + title row */}
        <View style={oc.topRow}>
          <View
            style={[
              oc.iconWrap,
              {
                backgroundColor: isSelected
                  ? opt.accentSoft
                  : colors.bgSecondary,
              },
            ]}
          >
            <AppText style={oc.icon}>{opt.icon}</AppText>
          </View>

          <View style={oc.textBlock}>
            <AppText
              style={[oc.title, isSelected && { color: opt.accent }]}
            >
              {opt.title}
            </AppText>
            <AppText style={oc.desc}>{opt.description}</AppText>
          </View>

          <View
            style={[
              oc.checkBox,
              isSelected && {
                backgroundColor: opt.accent,
                borderColor: opt.accent,
              },
            ]}
          >
            {isSelected ? (
              <AppText style={oc.checkMark}>✓</AppText>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const oc = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.card,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  accentBar: {
    width: 4,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
  },
  body: {
    flex: 1,
    padding: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  icon: {
    fontSize: 18,
    lineHeight: 24,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  desc: {
    fontSize: typescale.size.xs,
    color: colors.muted,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "transparent",
  },
  checkMark: {
    fontSize: 12,
    fontWeight: typescale.weight.bold,
    color: "#fff",
    lineHeight: 16,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  headerIcon: {
    fontSize: 22,
    lineHeight: 28,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: colors.text,
  },
  subtitle: {
    fontSize: typescale.size.sm,
    color: colors.muted,
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
    backgroundColor: colors.teal,
  },
  sectionLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
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
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingChipText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
  },

  // Security note
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  securityDot: {
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 0,
  },
  securityText: {
    flex: 1,
    fontSize: typescale.size.xs,
    color: colors.muted,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
  },

  // Generate button
  generateBtn: {
    height: 54,
    backgroundColor: colors.teal,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  generateBtnDisabled: {
    backgroundColor: colors.bgSecondary,
    shadowOpacity: 0,
    elevation: 0,
    borderWidth: 1,
    borderColor: colors.border,
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
    color: colors.subtle,
  },

  // ── Modal ────────────────────────────────────────────────────────────────

  modal: {
    flex: 1,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
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
    borderBottomColor: colors.border,
  },
  modalHeaderText: {
    gap: 3,
  },
  modalTitle: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: typescale.size.xs,
    color: colors.muted,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bgSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  modalCloseBtnText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
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
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    width: "100%",
    ...shadows.card,
  },
  loadingTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
    textAlign: "center",
  },
  loadingBody: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },

  // Error card
  errorCard: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "#FECACA",
    padding: spacing.xxl,
    width: "100%",
  },
  errorIcon: {
    fontSize: 36,
    lineHeight: 44,
  },
  errorTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: colors.text,
  },
  errorBody: {
    fontSize: typescale.size.sm,
    color: colors.danger,
    textAlign: "center",
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  dismissBtn: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dismissBtnText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.textSub,
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
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#6EE7B7",
  },
  successDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  successBadgeText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.success,
  },
  qrCard: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  urlCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    width: "100%",
    gap: 5,
  },
  urlLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  urlText: {
    fontSize: typescale.size.sm,
    color: colors.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
  },
  copyBtn: {
    width: "100%",
    height: 50,
    backgroundColor: colors.teal,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  copyBtnSuccess: {
    backgroundColor: colors.success,
    shadowColor: colors.success,
  },
  copyBtnText: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  includedBlock: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  includedLabel: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.muted,
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
  includedIcon: {
    fontSize: 14,
    lineHeight: 20,
  },
  includedText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.text,
  },
});
