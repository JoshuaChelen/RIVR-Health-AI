import React, { useCallback, useRef, useState } from "react";
import {
  View,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppText } from "../../components/ui/Primitives/AppText";
import { askHealthQuestion, type AiQuestionSource } from "../../lib/aiQuestionSearch";
import { spacing, radius, typescale } from "../../theme/tokens";
import { createStyles } from "../../theme/createStyles";
import { useTheme } from "../../context/ThemeContext";

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  sources?: AiQuestionSource[];
  error?: boolean;
};

const EXAMPLE_PROMPTS = [
  "What medications am I currently taking?",
  "Summarize my most recent lab results.",
  "What conditions have I been diagnosed with?",
  "When was my last visit and what happened?",
];

// Number of prior turns sent back as conversation context (the server also caps).
const HISTORY_LIMIT = 10;

let _id = 0;
const nextId = () => `m${(_id += 1)}`;

export function AskAIScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || sending) return;

      // Conversation context: prior, non-errored turns, capped.
      const history = messages
        .filter((m) => !m.error)
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, { id: nextId(), role: "user", content: q }]);
      setInput("");
      setSending(true);
      scrollToEnd();

      const result = await askHealthQuestion(q, history);
      const reply: ChatMessage =
        result.status === "answered"
          ? { id: nextId(), role: "assistant", content: result.answer, sources: result.sources }
          : result.status === "unavailable"
          ? { id: nextId(), role: "assistant", content: result.message, error: true }
          : { id: nextId(), role: "assistant", content: "I couldn't find an answer.", error: true };

      setMessages((prev) => [...prev, reply]);
      setSending(false);
      scrollToEnd();
    },
    [messages, sending, scrollToEnd],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isUser = item.role === "user";
      return (
        <View style={[styles.row, isUser ? styles.rowUser : styles.rowAi]}>
          <View
            style={[
              styles.bubble,
              isUser ? styles.bubbleUser : item.error ? styles.bubbleError : styles.bubbleAi,
            ]}
          >
            <AppText style={isUser ? styles.bubbleUserText : styles.bubbleAiText}>
              {item.content}
            </AppText>
          </View>
          {item.sources && item.sources.length > 0 ? (
            <View style={styles.sources}>
              {item.sources.slice(0, 4).map((s, i) => (
                <View key={`${item.id}-s${i}`} style={styles.sourceChip}>
                  <Ionicons
                    name={s.type === "timeline" ? "time-outline" : "document-text-outline"}
                    size={11}
                    color={colors.muted}
                  />
                  <AppText style={styles.sourceChipText} numberOfLines={1}>
                    {s.title}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      );
    },
    [styles, colors],
  );

  const canSend = !!input.trim() && !sending;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          messages.length === 0 && styles.listEmpty,
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles-outline" size={26} color={colors.teal} />
            </View>
            <AppText style={styles.emptyTitle}>Ask about your health records</AppText>
            <AppText style={styles.emptySub}>
              I answer using your uploaded documents, timeline, and health summary.
            </AppText>
            <View style={styles.examples}>
              {EXAMPLE_PROMPTS.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => send(p)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.example, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.teal} />
                  <AppText style={styles.exampleText}>{p}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListFooterComponent={
          sending ? (
            <View style={[styles.row, styles.rowAi]}>
              <View style={[styles.bubble, styles.bubbleAi, styles.typing]}>
                <ActivityIndicator size="small" color={colors.muted} />
                <AppText style={styles.typingText}>Thinking…</AppText>
              </View>
            </View>
          ) : null
        }
      />

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your records…"
          placeholderTextColor={colors.subtle}
          multiline
          editable={!sending}
          accessibilityLabel="Ask the AI a question"
        />
        <Pressable
          onPress={() => send(input)}
          disabled={!canSend}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={({ pressed }) => [
            styles.sendBtn,
            !canSend && styles.sendBtnDisabled,
            pressed && canSend && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = createStyles((c) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },

    listContent: { padding: spacing.md, gap: spacing.xs, flexGrow: 1 },
    listEmpty: { justifyContent: "center" },

    row: { marginBottom: spacing.xs },
    rowUser: { alignItems: "flex-end" },
    rowAi: { alignItems: "flex-start" },

    bubble: {
      maxWidth: "86%",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
    },
    bubbleUser: { backgroundColor: c.teal, borderBottomRightRadius: 6 },
    bubbleAi: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderBottomLeftRadius: 6,
    },
    bubbleError: {
      backgroundColor: c.bgSecondary,
      borderWidth: 1,
      borderColor: c.border,
      borderBottomLeftRadius: 6,
    },
    bubbleUserText: {
      color: "#fff",
      fontSize: typescale.size.sm,
      lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    },
    bubbleAiText: {
      color: c.text,
      fontSize: typescale.size.sm,
      lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    },

    sources: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: spacing.xs,
      maxWidth: "86%",
    },
    sourceChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.bgSecondary,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
      maxWidth: 180,
    },
    sourceChipText: { fontSize: typescale.size.xs, color: c.muted, flexShrink: 1 },

    typing: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    typingText: { color: c.muted, fontSize: typescale.size.sm },

    empty: { alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.sm },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.tealSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xs,
    },
    emptyTitle: {
      fontSize: typescale.size.lg,
      fontWeight: typescale.weight.bold,
      color: c.text,
      textAlign: "center",
    },
    emptySub: {
      fontSize: typescale.size.sm,
      color: c.textSub,
      textAlign: "center",
      lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    },
    examples: { gap: spacing.xs, marginTop: spacing.md, alignSelf: "stretch" },
    example: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    exampleText: { fontSize: typescale.size.sm, color: c.text, flexShrink: 1 },

    inputBar: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.bg,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 40,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: typescale.size.sm,
      color: c.text,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.teal,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: { backgroundColor: c.border },
  }),
);
