import { View, Text, StyleSheet, Pressable, FlatList } from "react-native";
import { useState } from "react";

type DocType = "summary" | "fhir";

const FILES: Record<DocType, string[]> = {
  summary: [
    "Lifestyle clinic.card.json",
    "New Patient H&P.card.json",
    "Orthopedics SOAP note.card.json",
    "Penn Medicine.card.json",
    "Primary care progress note.card.json",
  ],
  fhir: [
    "Lifestyle clinic.fhir.json",
    "New Patient H&P.fhir.json",
    "Orthopedics SOAP note.fhir.json",
    "Penn Medicine.fhir.json",
    "Primary care progress note.fhir.json",
  ],
};

export default function ShareDocumentsQR() {
  const [type, setType] = useState<DocType>("summary");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Share documents via QR</Text>

      {/* Document type selector */}
      <View style={styles.toggle}>
        <Pressable
          style={[styles.toggleBtn, type === "summary" && styles.active]}
          onPress={() => {
            setType("summary");
            setSelectedFile(null);
          }}
        >
          <Text style={styles.toggleText}>Summary (card)</Text>
        </Pressable>

        <Pressable
          style={[styles.toggleBtn, type === "fhir" && styles.active]}
          onPress={() => {
            setType("fhir");
            setSelectedFile(null);
          }}
        >
          <Text style={styles.toggleText}>FHIR</Text>
        </Pressable>
      </View>

      <Text style={styles.subheader}>Select a document</Text>

      {/* File list */}
      <FlatList
        data={FILES[type]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => {
          const selected = item === selectedFile;
          return (
            <Pressable
              onPress={() => setSelectedFile(item)}
              style={[
                styles.row,
                selected && styles.rowSelected,
              ]}
            >
              <Text
                style={[
                  styles.rowText,
                  selected && styles.rowTextSelected,
                ]}
              >
                {item}
              </Text>
            </Pressable>
          );
        }}
      />

      {selectedFile && (
        <Text style={styles.selected}>
          Selected: {selectedFile}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  subheader: { fontSize: 16, fontWeight: "600", marginVertical: 10 },

  toggle: { flexDirection: "row", gap: 10, marginBottom: 8 },
  toggleBtn: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
  },
  active: { backgroundColor: "#E5E7EB" },
  toggleText: { fontWeight: "600" },

  row: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 8,
  },
  rowSelected: { backgroundColor: "#111827" },
  rowText: { fontSize: 14 },
  rowTextSelected: { color: "white" },

  selected: {
    marginTop: 12,
    fontWeight: "600",
  },
});
