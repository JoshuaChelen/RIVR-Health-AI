import { useMemo } from "react";
import { useTheme } from "../context/ThemeContext";
import type { Colors } from "./tokens";

/**
 * Factory for theme-aware style hooks.
 *
 * Usage:
 *   const useStyles = createStyles((c) => StyleSheet.create({ ... }));
 *
 *   function MyComponent() {
 *     const styles = useStyles();
 *     return <View style={styles.container} />;
 *   }
 *
 * The returned hook memoizes the result — StyleSheet.create only re-runs
 * when the color palette actually changes (light ↔ dark).
 */
export function createStyles<T>(factory: (colors: Colors) => T): () => T {
  return () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { colors } = useTheme();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMemo(() => factory(colors), [colors]);
  };
}
