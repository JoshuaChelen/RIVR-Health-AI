import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Share,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { PrimaryButton } from "../../components/ui/Primitives/PrimaryButton";
import { colors, spacing, radius, typescale } from "../../theme/tokens";

type Props = NativeStackScreenProps<AppStackParamList, "PreVisitNote">;

type DatePrecision = "day" | "month" | "year";

type TimelineEventRow = {
  id: string;
  occurred_at: string;
  date_precision: DatePrecision;
  title: string;
  category: string;
  source: string;
  summary: string;
  included_in_previsit: boolean;
};

export function PreVisitNoteScreen({ navigation }: Props) {
  const [rows, setRows]           = useState<TimelineEventRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setLoading(true);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userData.user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("timeline_events")
        .select("id, occurred_at, date_precision, title, category, source, summary, included_in_previsit")
        .eq("user_id", userData.user.id)
        .eq("included_in_previsit", true)
        .order("occurred_at", { ascending: false });

      if (error) throw error;
      setRows((data ?? []) as TimelineEventRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load pre-visit note.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const noteText = useMemo(() => {
    if (rows.length === 0) {
      return 'No items selected yet.\n\nGo back to Timeline and toggle "Include in Pre-Visit Note" on a few events.';
    }

    const lines: string[] = [];
    lines.push("Pre-Visit Note Draft");
    lines.push(`Generated: ${new Date().toLocaleDateString()}`);
    lines.push("");
    lines.push("Included timeline items:");
    lines.push("");

    for (const ev of rows) {
      lines.push(
        `• ${formatEventDate(ev.occurred_at, ev.date_precision)} — ${ev.title} (${ev.category})`
      );
      if (ev.summary?.trim()) lines.push(`  ${ev.summary.trim()}`);
      lines.push("");
    }

    return lines.join("\n").trim();
  }, [rows]);

  const onShare = async () => {
    try { await Share.share({ message: noteText }); }
    catch { /* ignore */ }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.teal}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <AppText variant="h1">Pre-Visit Note</AppText>
            <AppText variant="muted" style={styles.headerSub}>
              {loading ? "Loading…" : `${rows.length} item${rows.length === 1 ? "" : "s"} included`}
            </AppText>
          </View>

          {rows.length > 0 ? (
            <Pressable
              onPress={onShare}
              style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.8 }]}
            >
              <AppText style={styles.shareBtnText}>Share</AppText>
            </Pressable>
          ) : null}
        </View>

        {err ? (
          <AppText variant="caption" style={{ color: colors.danger }}>{err}</AppText>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : null}

        {/* Note body */}
        <Card style={styles.noteCard}>
          <AppText variant="mono" style={styles.noteText}>{noteText}</AppText>
        </Card>

        {/* Back link */}
        <Pressable
          onPress={() => navigation.navigate("Timeline")}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="caption" style={styles.backText}>← Back to Timeline</AppText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatEventDate(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);
  if (precision === "year")  return `${dt.getFullYear()}`;
  if (precision === "month") return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return dt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: spacing.xs,
  },
  headerSub: {
    marginTop: 3,
  },
  shareBtn: {
    backgroundColor: colors.tealSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  shareBtnText: {
    color: colors.teal,
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.sm,
  },

  center: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },

  noteCard: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  noteText: {
    color: colors.text,
    lineHeight: typescale.size.base * typescale.lineHeight.relaxed,
  },

  backBtn: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  backText: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
  },
});
