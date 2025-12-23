// src/navigation/AppNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types"
import {HomeScreen} from "../screens/HomeScreen"
import { ShareFileScreen } from "../screens/ShareFileScreen";
import { DocumentsListScreen } from "../screens/DocumentsListScreen";

import { ShareSelectDocumentScreen } from "../screens/ShareSelectDocumentScreen";
import { ShareSelectFormatScreen } from "../screens/ShareSelectFormatScreen";
import { ShareOutScreen } from "../screens/ShareOutScreen";
import { DebugStorageScreen } from "../screens/DebugStorageScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen}/>
      <Stack.Screen name="ShareFile" component={ShareFileScreen}/>
      <Stack.Screen name="DocumentsList" component={DocumentsListScreen}/>
      <Stack.Screen name="DebugStorage" component={DebugStorageScreen} />
      <Stack.Screen
        name="ShareSelectDocument"
        component={ShareSelectDocumentScreen}
        options={{ title: "Select document" }}
      />
      <Stack.Screen
        name="ShareSelectFormat"
        component={ShareSelectFormatScreen}
        options={{ title: "Choose format" }}
      />
      <Stack.Screen
        name="ShareOut"
        component={ShareOutScreen}
        options={{ title: "Share" }}
      />
    
    </Stack.Navigator>
  );
}
