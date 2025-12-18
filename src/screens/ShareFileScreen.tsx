// src/screens/DetailsScreen.tsx
import React from "react";
import { View, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShareFile">;

export function ShareFileScreen({ route }: Props) {
  return (
    <View>
      <Text>Share Document Screen</Text>
    </View>
  );
}
