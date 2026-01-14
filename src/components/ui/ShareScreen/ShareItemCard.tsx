import React from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

type Props = {
  title: string;
  url: string;
};

export function ShareItemCard({ title, url }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>

      <Text selectable style={styles.url}>
        {url}
      </Text>

      <Button title="Copy link" onPress={() => Clipboard.setStringAsync(url)} />

      <View style={styles.qrWrap}>
        <QRCode value={url} size={180} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: "700" },
  url: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  qrWrap: { alignItems: "center", marginTop: 6 },
});
