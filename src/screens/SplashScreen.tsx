import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { AuthLogo } from "../components/ui/Account/AuthLogo";
import { AppText } from "../components/ui/Primitives/AppText";
import { typescale } from "../theme/tokens";
import { createStyles } from "../theme/createStyles";
import { useTheme } from "../context/ThemeContext";

type Props = {
  onFinish: () => void;
};

export function SplashScreen({ onFinish }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const logoOpacity   = useRef(new Animated.Value(0)).current;
  const logoScale     = useRef(new Animated.Value(0.8)).current;
  const nameOpacity   = useRef(new Animated.Value(0)).current;
  const nameSlide     = useRef(new Animated.Value(12)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      // a) Logo fades in + scales from 0.8 → 1.0
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // b) App name fades in + slides up 12px (200ms delay built into sequence)
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(nameOpacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(nameSlide, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // c) Tagline fades in (100ms delay after name)
      Animated.delay(100),
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      // d) Hold for 600ms then call onFinish
      Animated.delay(600),
    ]).start(() => {
      onFinish();
    });
    // Run the splash sequence once on mount; onFinish is the initial app bootstrap callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <LinearGradient
      colors={[colors.bg, colors.tealSoft]}
      style={styles.container}
    >
      <View style={styles.center}>
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          }}
        >
          <AuthLogo size={90} />
        </Animated.View>

        <Animated.View
          style={{
            opacity: nameOpacity,
            transform: [{ translateY: nameSlide }],
            marginTop: 20,
          }}
        >
          <AppText style={styles.appName}>RIVR Health</AppText>
        </Animated.View>

        <Animated.View style={{ opacity: taglineOpacity, marginTop: 8 }}>
          <AppText style={styles.tagline}>Your health, organized.</AppText>
        </Animated.View>
      </View>
    </LinearGradient>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  center: {
    alignItems: "center",
  },
  appName: {
    fontSize: typescale.size.xxl,
    fontWeight: typescale.weight.bold,
    color: c.text,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: typescale.size.base,
    color: c.muted,
  },
}));
