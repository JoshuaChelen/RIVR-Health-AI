import { Platform } from "react-native";

// ─── Color palette type ──────────────────────────────────────────────────────
export type Colors = typeof lightColors;

// ─── Light colors ────────────────────────────────────────────────────────────
export const lightColors = {
  // Backgrounds
  bg:          "#F5F8FA",
  bgSecondary: "#EDF2F7",
  surface:     "#FFFFFF",
  border:      "#E4ECF2",
  borderLight: "#F0F5F9",

  // Text
  text:    "#0D1B2A",
  textSub: "#3D526B",
  muted:   "#64748B",
  subtle:  "#94A3B8",

  // Status
  danger:       "#DC2626",
  dangerSoft:   "#FEF2F2",
  dangerBorder: "#FECACA",
  warning:     "#D97706",
  warnSoft:    "#FFFBEB",
  success:       "#059669",
  successSoft:   "#ECFDF5",
  successBorder: "#6EE7B7",

  // Primary accent — teal (medical palette)
  teal:       "#1FADA6",
  tealMid:    "#2CB9B0",
  tealSoft:   "#E6FAF8",
  tealBorder: "rgba(31,173,166,0.25)",

  // Supporting accents
  blue:       "#2563EB",
  blueSoft:   "#EFF6FF",
  green:      "#059669",
  greenSoft:  "#ECFDF5",
  orange:     "#EA7C2B",
  orangeSoft: "#FFF4E8",
  red:        "#EF4444",
  redSoft:    "#FFECEC",
};

// Backward-compatible alias — prefer useTheme().colors in components
export const colors = lightColors;

// ─── Dark colors ─────────────────────────────────────────────────────────────
export const darkColors: Colors = {
  // Backgrounds
  bg:          "#0D1B2A",
  bgSecondary: "#1B2838",
  surface:     "#1E293B",
  border:      "#334155",
  borderLight: "#1E293B",

  // Text
  text:    "#F1F5F9",
  textSub: "#CBD5E1",
  muted:   "#94A3B8",
  subtle:  "#64748B",

  // Status
  danger:       "#EF4444",
  dangerSoft:   "#2D1B1B",
  dangerBorder: "#7F1D1D",
  warning:     "#D97706",
  warnSoft:    "#2D2510",
  success:       "#059669",
  successSoft:   "#0D2D1B",
  successBorder: "#065F46",

  // Primary accent — teal
  teal:       "#1FADA6",
  tealMid:    "#2CB9B0",
  tealSoft:   "#0D2D2B",
  tealBorder: "rgba(31,173,166,0.30)",

  // Supporting accents
  blue:       "#3B82F6",
  blueSoft:   "#172554",
  green:      "#10B981",
  greenSoft:  "#0D2D1B",
  orange:     "#F59E0B",
  orangeSoft: "#2D2510",
  red:        "#EF4444",
  redSoft:    "#2D1B1B",
};

// ─── Typography scale ─────────────────────────────────────────────────────────
export const typescale = {
  size: {
    xs:   11,
    sm:   12,
    base: 14,
    md:   15,
    lg:   17,
    xl:   20,
    xxl:  24,
    hero: 32,
  },
  weight: {
    regular:   "400" as const,
    medium:    "500" as const,
    semibold:  "600" as const,
    bold:      "700" as const,
    extrabold: "800" as const,
    black:     "900" as const,
  },
  lineHeight: {
    tight:   1.2,
    normal:  1.45,
    relaxed: 1.65,
  },
};

// ─── Spacing ──────────────────────────────────────────────────────────────────
export const spacing = {
  xxs: 4,
  xs:  6,
  sm:  10,
  md:  14,
  lg:  18,
  xl:  24,
  xxl: 32,
};

// ─── Border radius ────────────────────────────────────────────────────────────
export const radius = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   18,
  xl:   22,
  pill: 999,
};

// ─── Shadows ──────────────────────────────────────────────────────────────────
export const shadows = {
  xs: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  card: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  lg: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.10,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
};

// ─── Fonts (system) ───────────────────────────────────────────────────────────
export const fonts = {
  regular:  Platform.select({ ios: "System", android: "Roboto" }) as string,
  semibold: Platform.select({ ios: "System", android: "Roboto" }) as string,
  bold:     Platform.select({ ios: "System", android: "Roboto" }) as string,
};
