import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lightColors, darkColors, type Colors } from "../theme/tokens";

type Preference = "system" | "light" | "dark";

type ThemeContextValue = {
  colorScheme: "light" | "dark";
  colors: Colors;
  preference: Preference;
  setPreference: (pref: Preference) => void;
};

const STORAGE_KEY = "rivr_theme_preference";

const ThemeContext = createContext<ThemeContextValue>({
  colorScheme: "light",
  colors: lightColors,
  preference: "system",
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme() ?? "light";
  const [preference, setPref] = useState<Preference>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "light" || val === "dark" || val === "system") setPref(val);
    });
  }, []);

  const setPreference = useCallback((pref: Preference) => {
    setPref(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref);
  }, []);

  const resolved = preference === "system" ? systemScheme : preference;
  const colors = resolved === "dark" ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colorScheme: resolved, colors, preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export type { Colors };
