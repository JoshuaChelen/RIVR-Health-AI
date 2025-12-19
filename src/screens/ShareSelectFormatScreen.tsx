import React from "react";
import { View, Button, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShareSelectFormat">;

export function ShareSelectFormatScreen({ navigation, route }: Props) {
  const { documentId, title } = route.params;

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>
        Share: {title ?? "(untitled)"}
      </Text>

      <Button
        title="Share FHIR JSON"
        onPress={() => navigation.navigate("ShareOut", { documentId, fileType: "fhir", title })}
      />

      <Button
        title="Share Summary Card JSON"
        onPress={() => navigation.navigate("ShareOut", { documentId, fileType: "card", title })}
      />
    </View>
  );
}
