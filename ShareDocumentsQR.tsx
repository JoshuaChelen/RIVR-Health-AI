import { View, Text, StyleSheet } from "react-native";

export default function ShareDocumentsQR() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Share Documents Through QR Code
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 18,
    fontWeight: "600",
  },
});
