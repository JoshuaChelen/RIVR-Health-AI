// src/screens/HomeScreen.tsx
import React from "react";
import { View, Button } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  return (
    <View style={{ padding: 16 }}>
      <Button
        title="Share a document"
        onPress={() => navigation.navigate("ShareFile")}
      />
    </View>
  );
}
