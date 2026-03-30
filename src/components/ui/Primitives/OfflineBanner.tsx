import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AppText } from "./AppText";
import { useNetwork } from "../../../context/NetworkContext";
import { spacing, typescale } from "../../../theme/tokens";

const BANNER_HEIGHT = 36;

export function OfflineBanner() {
  const { isConnected } = useNetwork();
  const slideAnim = useRef(new Animated.Value(-BANNER_HEIGHT)).current;
  const isOffline = isConnected === false;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOffline ? 0 : -BANNER_HEIGHT,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isOffline]);

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel="You're offline"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Ionicons name="cloud-offline-outline" size={14} color="#fff" accessible={false} />
        <AppText style={styles.text}>You're offline</AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: BANNER_HEIGHT,
    backgroundColor: `rgba(217,119,6,0.90)`,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  text: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold as any,
    color: "#fff",
  },
});
