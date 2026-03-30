import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { AppText } from "../Primitives/AppText";
import { Card } from "../Primitives/Card";
import { radius, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = {
  title: string;
  url: string;
};

export function ShareItemCard({ title, url }: Props) {
  const styles = useStyles();
  return (
    <Card style={styles.card}>
      <AppText variant="title" style={styles.title}>{title}</AppText>

      <View style={styles.urlBox}>
        <AppText variant="caption" style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </AppText>
      </View>

      <Pressable
        onPress={() => Clipboard.setStringAsync(url)}
        style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.8 }]}
      >
        <AppText style={styles.copyText}>Copy link</AppText>
      </Pressable>

      <View style={styles.qrWrap}>
        <QRCode value={url} size={180} />
      </View>
    </Card>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  card: { gap: 12 },
  title: {
    color: c.text,
    marginBottom: 2,
  },
  urlBox: {
    backgroundColor: c.bgSecondary,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  urlText: {
    color: c.textSub,
  },
  copyBtn: {
    backgroundColor: c.teal,
    borderRadius: radius.md,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  copyText: {
    color: "#fff",
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.base,
  },
  qrWrap: {
    alignItems: "center",
    paddingVertical: 12,
  },
}));
