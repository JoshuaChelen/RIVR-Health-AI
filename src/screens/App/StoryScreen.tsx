import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { getHealthProfile, getLatestEvaluation } from "../../lib/api/data";
import { triggerProfileEvalAfterSave } from "../../lib/triggerProfileEval";
import { getProfile, upsertProfile, type UserProfile, type StoryAnswers } from "../../lib/profile";
import { getCurrentUserId } from "../../lib/auth";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";

import { captureException } from "../../lib/sentry";
import { radius, shadows, spacing, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";

type Props = NativeStackScreenProps<AppStackParamList, "Story">;

// ─── Question definitions ─────────────────────────────────────────────────────
// Keys are stable DB references. Text can evolve without a migration.

type QuestionDef = { key: keyof StoryAnswers; text: string };

const QUESTIONS: QuestionDef[] = [
  { key: "q1",  text: "Tell me about your relationships that are the most important to you and why." },
  { key: "q2",  text: "Tell me how you would describe your health approach. What does \"being healthy\" look like to you?" },
  { key: "q3",  text: "Tell me about a positive memory you have from childhood. How old were you?" },
  { key: "q4",  text: "Tell me about your parents' relationship when you were growing up. How did you feel with them and your siblings?" },
  { key: "q5",  text: "What are things you are good at in terms of health, and what are things that are difficult for you?" },
  { key: "q6",  text: "How would you describe the season of life you're in right now?" },
  { key: "q7",  text: "What roles feel most important to you right now (parent, partner, worker, caregiver, etc.)?" },
  { key: "q8",  text: "On a typical day, what takes most of your time and energy?" },
  { key: "q9",  text: "If you had an extra free hour most days, how would you honestly want to use it?" },
  { key: "q10", text: "When you hear the word \"health,\" what comes to mind first?" },
];

// ─── QuestionCard ─────────────────────────────────────────────────────────────

type QuestionCardProps = {
  number: number;
  text: string;
  answer: string | undefined;
  isEditing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
};

function QuestionCard({
  number, text, answer, isEditing,
  draft, onDraftChange,
  onStartEdit, onSave, onCancel,
  saving, error,
}: QuestionCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const answered = !!(answer?.trim());

  return (
    <View style={[styles.qc_card, answered && !isEditing && styles.qc_cardAnswered]}>

      {/* ── Top row: number pill + edit button ── */}
      <View style={styles.qc_topRow}>
        <View style={[styles.qc_pill, answered && styles.qc_pillAnswered]}>
          <AppText style={[styles.qc_pillText, answered && styles.qc_pillTextAnswered]}>
            {String(number).padStart(2, "0")}
          </AppText>
        </View>
        {!isEditing && answered && (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Edit answer"
            onPress={onStartEdit}
            style={({ pressed }) => [styles.qc_editBtn, pressed && { opacity: 0.6 }]}
          >
            <AppText style={styles.qc_editBtnText}>Edit</AppText>
          </Pressable>
        )}
      </View>

      {/* ── Question text ── */}
      <AppText style={styles.qc_questionText}>{text}</AppText>

      {/* ── Content: edit / answer / empty ── */}
      {isEditing ? (
        <View style={styles.qc_editArea}>
          <View style={[styles.qc_textAreaWrap, focused && styles.qc_textAreaFocused]}>
            <TextInput
              value={draft}
              onChangeText={onDraftChange}
              multiline
              textAlignVertical="top"
              placeholder="Write your answer here…"
              placeholderTextColor={colors.subtle}
              showSoftInputOnFocus
              style={styles.qc_textInput}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
              accessibilityLabel="Your answer"
            />
          </View>

          {error ? (
            <View style={styles.qc_errorBanner}>
              <AppText style={styles.qc_errorText}>{error}</AppText>
            </View>
          ) : null}

          <View style={styles.qc_actions}>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              onPress={onCancel}
              style={({ pressed }) => [styles.qc_cancelBtn, pressed && { opacity: 0.6 }]}
            >
              <AppText style={styles.qc_cancelText}>Cancel</AppText>
            </Pressable>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Save answer"
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.qc_saveBtn,
                saving && { opacity: 0.5 },
                pressed && !saving && { opacity: 0.82 },
              ]}
            >
              <AppText style={styles.qc_saveText}>{saving ? "Saving…" : "Save"}</AppText>
            </Pressable>
          </View>
        </View>

      ) : answered ? (
        <AppText style={styles.qc_answerText}>{answer}</AppText>
      ) : (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Write your answer"
          onPress={onStartEdit}
          style={({ pressed }) => [styles.qc_addBtn, pressed && { opacity: 0.6 }]}
        >
          <AppText style={styles.qc_addText}>+ Write your answer</AppText>
        </Pressable>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function StoryScreen(_: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  const [profile, setProfile]     = useState<UserProfile | null>(null);
  const [loading, setLoading]     = useState(true);
  const [editingQ, setEditingQ]     = useState<keyof StoryAnswers | null>(null);
  const [refreshingHealth, setRefreshingHealth] = useState(false);
  const [draft, setDraft]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const userId = await getCurrentUserId();
          if (!active) return;
          const p = await getProfile(userId);
          if (active) setProfile(p);
        } catch (e) {
          captureException(e);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  function startEdit(key: keyof StoryAnswers) {
    setSaveError(null);
    setDraft(profile?.story_answers?.[key] ?? "");
    setEditingQ(key);
  }

  function cancelEdit() {
    setSaveError(null);
    setEditingQ(null);
    setDraft("");
  }

async function saveAnswer() {
  if (!editingQ) return;

  setSaveError(null);
  setSaving(true);

  try {
    const userId = await getCurrentUserId();

    const current = { ...(profile?.story_answers ?? {}) } as StoryAnswers;
    const trimmed = draft.trim();

    if (trimmed) {
      current[editingQ] = trimmed;
    } else {
      delete current[editingQ];
    }

    const updated = await upsertProfile(userId, { story_answers: current });
    setProfile(updated);
    setEditingQ(null);
    setDraft("");

    // show banner immediately
    setRefreshingHealth(true);

    void (async () => {
      try {
        const beforeProfile = profile?.updated_at ?? null;

        await triggerProfileEvalAfterSave();

        const startedAt = Date.now();
        const timeoutMs = 60_000;
        const intervalMs = 3000;

        while (Date.now() - startedAt < timeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));

          const [nextProfile, nextEval] = await Promise.all([
            getHealthProfile(),
            getLatestEvaluation(),
          ]);

          const nextProfileUpdated = nextProfile?.updated_at ?? null;
          const hasFreshProfile =
            nextProfileUpdated &&
            (!beforeProfile || new Date(nextProfileUpdated).getTime() > new Date(beforeProfile).getTime());

          const hasEval =
            !!nextEval?.result;

          if (hasFreshProfile || hasEval) {
            break;
          }
        }
      } catch (e) {
        captureException(e);
      } finally {
        setRefreshingHealth(false);
      }
    })();
  } catch (e: any) {
    captureException(e);
    setSaveError(e?.message ?? "Save failed. Please try again.");
  } finally {
    setSaving(false);
  }
}

  // ── Derived state ─────────────────────────────────────────────────────────
  const answers = profile?.story_answers ?? {};
  const answeredCount = QUESTIONS.filter(({ key }) => answers[key]?.trim()).length;
  const allAnswered = answeredCount === QUESTIONS.length;

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Screen edges={["left", "right", "bottom"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} size="large" accessibilityLabel="Loading health story" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Header ────────────────────────────────────── */}
          <View style={styles.header}>
            <AppText style={styles.headerTitle}>Your Health Story</AppText>
            <AppText style={styles.headerSub}>
              These reflections help us understand you as a whole person —
              not just a patient. All questions are optional.
            </AppText>

            {/* Progress bar */}
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(answeredCount / QUESTIONS.length) * 100}%` as any },
                  ]}
                />
              </View>
              <AppText style={styles.progressLabel}>
                {answeredCount} of {QUESTIONS.length} answered
              </AppText>
            </View>
          </View>

          {/* ── Subtle refresh notice ─────────────────────── */}
          {refreshingHealth && (
            <View style={styles.refreshBanner}>
              <AppText variant="caption" style={styles.refreshText}>
                Refreshing your health summary…
              </AppText>
            </View>
          )}

          {/* ── Completion badge ──────────────────────────── */}
          {allAnswered && (
            <View style={styles.completionBadge}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.teal} />
                <AppText style={styles.completionText}>
                  {"You've answered every question"}
                </AppText>
            </View>
          )}

          {/* ── Questions ─────────────────────────────────── */}
          {QUESTIONS.map((q, i) => (
            <QuestionCard
              key={q.key}
              number={i + 1}
              text={q.text}
              answer={answers[q.key]}
              isEditing={editingQ === q.key}
              draft={editingQ === q.key ? draft : ""}
              onDraftChange={setDraft}
              onStartEdit={() => startEdit(q.key)}
              onSave={saveAnswer}
              onCancel={cancelEdit}
              saving={saving}
              error={editingQ === q.key ? saveError : null}
            />
          ))}

          <AppText style={styles.footerNote}>
            Your story is private. It may be used to personalize coaching and
            context — never shared without your consent.
          </AppText>

        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = createStyles((c) => StyleSheet.create({
  // ── QuestionCard (qc) ──────────────────────────────────────────────────
  qc_card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.xs,
  },
  qc_cardAnswered: {
    borderColor: c.tealBorder,
  },
  qc_topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  qc_pill: {
    backgroundColor: c.bgSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  qc_pillAnswered: {
    backgroundColor: c.tealSoft,
  },
  qc_pillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold as any,
    color: c.muted,
    letterSpacing: 0.8,
  },
  qc_pillTextAnswered: {
    color: c.teal,
  },
  qc_editBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: c.tealSoft,
  },
  qc_editBtnText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.teal,
  },
  qc_questionText: {
    fontSize: typescale.size.md,
    fontWeight: typescale.weight.semibold as any,
    color: c.text,
    lineHeight: typescale.size.md * typescale.lineHeight.relaxed,
  },
  qc_answerText: {
    fontSize: typescale.size.base,
    color: c.textSub,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    fontStyle: "italic",
    paddingTop: 2,
  },
  qc_addBtn: {
    paddingVertical: spacing.xs,
    paddingTop: spacing.xxs,
  },
  qc_addText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.teal,
  },
  qc_editArea: {
    gap: spacing.sm,
    paddingTop: spacing.xxs,
  },
  qc_textAreaWrap: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    backgroundColor: c.bg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 120,
  },
  qc_textAreaFocused: {
    borderColor: c.teal,
    borderWidth: 1.5,
    shadowColor: c.teal,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  qc_textInput: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.regular as any,
    color: c.text,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
    minHeight: 100,
  },
  qc_errorBanner: {
    backgroundColor: c.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.dangerBorder,
  },
  qc_errorText: {
    fontSize: typescale.size.sm,
    color: c.danger,
  },
  qc_actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
  },
  qc_cancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  qc_cancelText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium as any,
    color: c.muted,
  },
  qc_saveBtn: {
    backgroundColor: c.teal,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 9,
  },
  qc_saveText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold as any,
    color: "#fff",
  },

  // ── Main styles ─────────────────────────────────────────────────────────
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: {
    paddingBottom: spacing.xxl + spacing.xl,
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
  },

  // ── Refresh banner ──
  refreshBanner: {
    backgroundColor: c.tealSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  refreshText: { color: c.teal },

  // ── Header ──
  header: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.xs,
  },
  headerTitle: {
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.bold as any,
    color: c.text,
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize: typescale.size.sm,
    color: c.muted,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: c.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: c.teal,
  },
  progressLabel: {
    fontSize: typescale.size.xs,
    color: c.muted,
    minWidth: 80,
    textAlign: "right",
  },

  // ── Completion ──
  completionBadge: {
    backgroundColor: c.tealSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.tealBorder,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  completionText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.teal,
  },

  // ── Footer ──
  footerNote: {
    textAlign: "center",
    fontSize: typescale.size.xs,
    color: c.subtle,
    lineHeight: typescale.size.xs * typescale.lineHeight.relaxed,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
}));
