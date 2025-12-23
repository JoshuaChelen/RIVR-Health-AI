// src/screens/HomeScreen.tsx
import React from "react";
import { View, Button, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { supabase } from "../lib/supabase";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  
  return (
    <View style={{ padding: 16 }}>
      <Button
        title="See all documents"
        onPress={() => navigation.navigate("DocumentsList")}
      />
      
      <Button
        title="Share a document"
        onPress={() => navigation.navigate("ShareSelectDocument")}
      />

      <Button
        title="Debug Storage"
        onPress={() => navigation.navigate("DebugStorage")}
      />


      <Button
        title = "Logout"
        onPress = {async () =>{
          await supabase.auth.signOut();
        }}
      />

      

    </View>
  );
}