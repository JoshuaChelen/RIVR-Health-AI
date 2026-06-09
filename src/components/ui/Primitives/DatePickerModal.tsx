import React, { useEffect, useState } from "react";
import { View, StyleSheet, Modal, Pressable, SafeAreaView, Platform } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AppText } from "./AppText";
import { radius, spacing, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

// Uses @react-native-community/datetimepicker when available; otherwise the
// arrow-spinner fallback below renders. (Install: npx expo install
// @react-native-community/datetimepicker)
let NativeDatePicker: any = null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
try { NativeDatePicker = require("@react-native-community/datetimepicker").default; } catch { /* not installed — fallback renders */ }

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Date-of-birth picker presented as an iOS bottom sheet (Android: native dialog). */
export function DatePickerModal({
  visible,
  date,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  date: Date;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}) {
  const dp = useStyles();
  const { colors } = useTheme();
  const [local, setLocal] = useState(date);
  useEffect(() => { setLocal(date); }, [date]);

  if (!visible) return null;

  if (NativeDatePicker) {
    if (Platform.OS === "android") {
      return (
        <NativeDatePicker
          value={local}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={(_: any, d?: Date) => { if (d) onConfirm(d); else onCancel(); }}
        />
      );
    }
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
        <Pressable style={dp.overlay} onPress={onCancel} />
        <SafeAreaView style={dp.sheet}>
          <View style={dp.handle} />
          <View style={dp.header}>
            <Pressable onPress={onCancel} style={dp.btn}>
              <AppText style={dp.cancel}>Cancel</AppText>
            </Pressable>
            <AppText style={dp.title}>Date of birth</AppText>
            <Pressable onPress={() => onConfirm(local)} style={dp.btn}>
              <AppText style={dp.done}>Done</AppText>
            </Pressable>
          </View>
          <NativeDatePicker
            value={local}
            mode="date"
            display="spinner"
            maximumDate={new Date()}
            minimumDate={new Date(1900, 0, 1)}
            onChange={(_: any, d?: Date) => d && setLocal(d)}
            style={{ height: 216 }}
          />
        </SafeAreaView>
      </Modal>
    );
  }

  // Fallback arrow spinner (up = increase, down = decrease).
  const y = local.getFullYear(), m = local.getMonth(), d = local.getDate();
  function adj(field: "y" | "m" | "d", delta: number) {
    const n = new Date(local);
    if (field === "y") n.setFullYear(y + delta);
    if (field === "m") n.setMonth(m + delta);
    if (field === "d") n.setDate(d + delta);
    if (n > new Date() || n < new Date(1900, 0, 1)) return;
    setLocal(n);
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={dp.overlay} onPress={onCancel} />
      <SafeAreaView style={dp.sheet}>
        <View style={dp.handle} />
        <View style={dp.header}>
          <Pressable onPress={onCancel} style={dp.btn}><AppText style={dp.cancel}>Cancel</AppText></Pressable>
          <AppText style={dp.title}>Date of birth</AppText>
          <Pressable onPress={() => onConfirm(local)} style={dp.btn}><AppText style={dp.done}>Done</AppText></Pressable>
        </View>
        <View style={dp.row}>
          {(["m", "d", "y"] as const).map((field) => {
            const val = field === "m" ? MONTHS[m].slice(0, 3) : field === "d" ? String(d).padStart(2, "0") : String(y);
            return (
              <View key={field} style={dp.col}>
                <Pressable onPress={() => adj(field, 1)} style={dp.arrowBtn}>
                  <Ionicons name="chevron-up" size={18} color={colors.teal} />
                </Pressable>
                <AppText style={dp.val}>{val}</AppText>
                <Pressable onPress={() => adj(field, -1)} style={dp.arrowBtn}>
                  <Ionicons name="chevron-down" size={18} color={colors.teal} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm, paddingBottom: spacing.xl,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
    alignSelf: "center", marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: c.borderLight, marginBottom: spacing.xs,
  },
  title: { fontSize: typescale.size.base, fontWeight: typescale.weight.semibold as any, color: c.text },
  btn: { paddingVertical: 4, paddingHorizontal: spacing.xs },
  cancel: { fontSize: typescale.size.base, color: c.muted },
  done: { fontSize: typescale.size.base, fontWeight: typescale.weight.semibold as any, color: c.teal },
  row: { flexDirection: "row", justifyContent: "center", gap: spacing.xl, paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  col: { alignItems: "center", gap: spacing.sm, flex: 1 },
  arrowBtn: { padding: spacing.sm },
  val: { fontSize: typescale.size.lg, fontWeight: typescale.weight.bold as any, color: c.text, minWidth: 60, textAlign: "center" },
}));
