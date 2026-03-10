import React, { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { AppText } from "./AppText";
import { colors, radius, shadows, spacing, typescale } from "../../../theme/tokens";

// ─── Country list ─────────────────────────────────────────────────────────────

export type Country = { flag: string; dial: string; code: string; name: string };

export const COUNTRIES: Country[] = [
  { flag: "🇺🇸", dial: "+1",   code: "US", name: "United States" },
  { flag: "🇨🇦", dial: "+1",   code: "CA", name: "Canada" },
  { flag: "🇬🇧", dial: "+44",  code: "GB", name: "United Kingdom" },
  { flag: "🇦🇺", dial: "+61",  code: "AU", name: "Australia" },
  { flag: "🇩🇪", dial: "+49",  code: "DE", name: "Germany" },
  { flag: "🇫🇷", dial: "+33",  code: "FR", name: "France" },
  { flag: "🇮🇳", dial: "+91",  code: "IN", name: "India" },
  { flag: "🇧🇷", dial: "+55",  code: "BR", name: "Brazil" },
  { flag: "🇲🇽", dial: "+52",  code: "MX", name: "Mexico" },
  { flag: "🇯🇵", dial: "+81",  code: "JP", name: "Japan" },
  { flag: "🇸🇬", dial: "+65",  code: "SG", name: "Singapore" },
  { flag: "🇦🇪", dial: "+971", code: "AE", name: "UAE" },
  { flag: "🇳🇿", dial: "+64",  code: "NZ", name: "New Zealand" },
  { flag: "🇿🇦", dial: "+27",  code: "ZA", name: "South Africa" },
  { flag: "🇰🇷", dial: "+82",  code: "KR", name: "South Korea" },
  { flag: "🇳🇬", dial: "+234", code: "NG", name: "Nigeria" },
  { flag: "🇵🇭", dial: "+63",  code: "PH", name: "Philippines" },
  { flag: "🇮🇹", dial: "+39",  code: "IT", name: "Italy" },
  { flag: "🇪🇸", dial: "+34",  code: "ES", name: "Spain" },
  { flag: "🇨🇳", dial: "+86",  code: "CN", name: "China" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a stored phone string like "+1 (555) 000-0000" → { country, number } */
export function parseStoredPhone(stored: string): { country: Country; number: string } {
  const defaultCountry = COUNTRIES[0]; // US
  if (!stored?.trim()) return { country: defaultCountry, number: "" };
  for (const c of COUNTRIES) {
    if (stored.startsWith(c.dial + " ")) {
      return { country: c, number: stored.slice(c.dial.length + 1) };
    }
    // Also match without space e.g. "+15550001234"
    if (stored.startsWith(c.dial)) {
      return { country: c, number: stored.slice(c.dial.length) };
    }
  }
  return { country: defaultCountry, number: stored };
}

/** Format US number as (XXX) XXX-XXXX; other countries pass through */
function formatNumber(raw: string, dialCode: string): string {
  const digits = raw.replace(/\D/g, "");
  if (dialCode === "+1") {
    if (digits.length === 0) return "";
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  return raw;
}

// ─── PhoneField ───────────────────────────────────────────────────────────────

type Props = {
  label?: string;
  country: Country;
  number: string;
  onCountryChange: (c: Country) => void;
  onNumberChange: (n: string) => void;
  editable?: boolean;
  returnKeyType?: "next" | "done" | "default";
};

export function PhoneField({
  label,
  country,
  number,
  onCountryChange,
  onNumberChange,
  editable = true,
  returnKeyType = "done",
}: Props) {
  const [focused, setFocused]   = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  function handleNumberChange(raw: string) {
    onNumberChange(formatNumber(raw, country.dial));
  }

  function handleCountrySelect(c: Country) {
    setShowPicker(false);
    // Reformat the existing number with the new dial code
    const digits = number.replace(/\D/g, "");
    onCountryChange(c);
    onNumberChange(formatNumber(digits, c.dial));
  }

  return (
    <View style={pf.container}>
      {label ? (
        <AppText variant="label" style={[pf.label, focused && pf.labelFocused]}>
          {label}
        </AppText>
      ) : null}

      <View style={[pf.wrap, focused && pf.wrapFocused]}>
        {/* Country prefix button */}
        <Pressable
          style={({ pressed }) => [pf.prefix, pressed && { opacity: 0.7 }]}
          onPress={() => editable && setShowPicker(true)}
          disabled={!editable}
        >
          <AppText style={pf.prefixFlag}>{country.flag}</AppText>
          <AppText style={pf.prefixDial}>{country.dial}</AppText>
          <AppText style={pf.prefixChevron}>▾</AppText>
        </Pressable>

        <View style={pf.divider} />

        <TextInput
          style={pf.input}
          value={number}
          onChangeText={handleNumberChange}
          placeholder="(555) 000-0000"
          placeholderTextColor={colors.subtle}
          keyboardType="phone-pad"
          returnKeyType={returnKeyType}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>

      {/* Country picker modal */}
      <Modal
        visible={showPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable style={pf.overlay} onPress={() => setShowPicker(false)} />
        <SafeAreaView style={pf.sheet}>
          <View style={pf.sheetHandle} />
          <AppText style={pf.sheetTitle}>Select country</AppText>
          <FlatList
            data={COUNTRIES}
            keyExtractor={(c) => c.code}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  pf.countryRow,
                  item.code === country.code && pf.countryRowSelected,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handleCountrySelect(item)}
              >
                <AppText style={pf.countryFlag}>{item.flag}</AppText>
                <AppText style={pf.countryName} numberOfLines={1}>{item.name}</AppText>
                <AppText style={pf.countryDial}>{item.dial}</AppText>
                {item.code === country.code && (
                  <AppText style={pf.checkmark}>✓</AppText>
                )}
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={pf.separator} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const pf = StyleSheet.create({
  container: { gap: 7 },
  label: { marginBottom: 1 },
  labelFocused: { color: colors.teal },

  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    height: 52,
    ...shadows.xs,
  },
  wrapFocused: {
    borderColor: colors.teal,
    borderWidth: 1.5,
    shadowColor: colors.teal,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  prefix: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 5,
    height: "100%" as any,
  },
  prefixFlag: { fontSize: 18, lineHeight: 24 },
  prefixDial: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: colors.text,
  },
  prefixChevron: {
    fontSize: 9,
    color: colors.muted,
    lineHeight: 14,
  },

  divider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },

  input: {
    flex: 1,
    height: "100%" as any,
    paddingHorizontal: 14,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium as any,
    color: colors.text,
  },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxHeight: "65%",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.bold as any,
    color: colors.text,
    textAlign: "center",
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    marginBottom: spacing.xs,
  },

  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  countryRowSelected: {
    backgroundColor: colors.tealSoft,
  },
  countryFlag: { fontSize: 22, lineHeight: 28, flexShrink: 0 },
  countryName: {
    flex: 1,
    fontSize: typescale.size.base,
    color: colors.text,
  },
  countryDial: {
    fontSize: typescale.size.sm,
    color: colors.muted,
    flexShrink: 0,
  },
  checkmark: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold as any,
    color: colors.teal,
    marginLeft: spacing.xs,
  },
  separator: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginHorizontal: spacing.xs,
  },
});
