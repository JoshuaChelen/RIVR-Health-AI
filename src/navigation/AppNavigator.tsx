// src/navigation/AppNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types"
import {HomeScreen} from "../screens/HomeScreen"
import { ShareScreen } from "../screens/ShareScreen";
import { TimelineScreen } from "../screens/TimelineScreen";
import { ListDocumentsScreen } from "../screens/ListDocumentsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen}/>
      <Stack.Screen name="ListDocuments" component={ListDocumentsScreen}/>
      <Stack.Screen name="Share" component={ShareScreen}/>
      <Stack.Screen name="Timeline" component={TimelineScreen} />
    </Stack.Navigator>
  );
}
