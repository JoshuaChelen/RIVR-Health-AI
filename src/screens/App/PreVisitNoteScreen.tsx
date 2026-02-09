import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Share,
  Text,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { supabase } from "../../lib/supabase";

import { Screen } from "../../components/ui/Primitives/Screen";
import { Card } from "../../components/ui/Primitives/Card";
import { AppText } from "../../components/ui/Primitives/AppText";
import { colors } from "../../theme/tokens";

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
  const [rows, setRows] = useState<TimelineEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setLoading(true);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userData.user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("timeline_events")
        .select(
          "id, occurred_at, date_precision, title, category, source, summary, included_in_previsit"
        )
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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const noteText = useMemo(() => {
    if (rows.length === 0) {
      return "No items selected yet.\n\nGo back to Timeline and toggle “Include in Pre-Visit Note” on a few events.";
    }

    const lines: string[] = [];
    lines.push("Pre-Visit Note Draft");
    lines.push(`Generated: ${new Date().toLocaleDateString()}`);
    lines.push("");
    lines.push("Included timeline items:");
    lines.push("");

    for (const ev of rows) {
      lines.push(
        `• ${formatEventDate(ev.occurred_at, ev.date_precision)} - ${ev.title} (${ev.category})`
      );
      if (ev.summary?.trim()) lines.push(`  ${ev.summary.trim()}`);
      lines.push("");
    }

    return lines.join("\n").trim();
  }, [rows]);

  const onShare = async () => {
    try {
      await Share.share({ message: noteText });
    } catch (e) {
      // ignore
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="h1">Pre-Visit Note</AppText>
            <AppText variant="muted">
              {loading ? "Loading..." : `${rows.length} item(s) included`}
            </AppText>
          </View>

          
            
          
        </View>

        {err ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {err}
          </AppText>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : null}

        <Card style={styles.noteCard}>
          <AppText variant="caption" style={styles.noteMono}>
            {noteText}
          </AppText>
        </Card>

        <Pressable
          onPress={() => navigation.navigate("Timeline")}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.backBtnText}>Back to Timeline</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatEventDate(ymd: string, precision: DatePrecision) {
  const dt = parseYMD(ymd);

  if (precision === "year") return `${dt.getFullYear()}`;

  if (precision === "month") {
    return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  return dt.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  center: {
    paddingVertical: 16,
    alignItems: "center",
  },
  noteCard: {
    padding: 14,
    gap: 10,
  },
  noteMono: {
    color: colors.text,
    lineHeight: 18,
  },
  backBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  backBtnText: {
    color: colors.teal,
    fontWeight: "900",
  },
});
