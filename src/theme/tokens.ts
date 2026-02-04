import { Platform } from "react-native";

export const colors = {
  bg: "#F7FAFC",          // soft off-white background (like the screenshots)
  surface: "#FFFFFF",     // cards
  border: "#E6EEF5",      // light border
  text: "#0F172A",        // primary text (dark navy)
  muted: "#64748B",       // secondary text
  subtle: "#94A3B8",      // placeholders, captions
  danger: "#DC2626",

  // accents (soft health app palette)
  teal: "#2CB9B0",
  tealSoft: "#E6FAF8",

  green: "#16A34A",
  greenSoft: "#EAFBF1",

  blue: "#2563EB",
  blueSoft: "#EAF2FF",

  orange: "#F97316",
  orangeSoft: "#FFF1E6",

  red: "#EF4444",
  redSoft: "#FFECEC",
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
};

export const fonts = {
  regular: Platform.select({ ios: "System", android: "Roboto" }) as string,
  semibold: Platform.select({ ios: "System", android: "Roboto" }) as string,
  bold: Platform.select({ ios: "System", android: "Roboto" }) as string,
};

export const shadows = {
  card: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
};
