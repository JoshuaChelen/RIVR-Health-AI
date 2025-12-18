// src/navigation/AppNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types"
import {HomeScreen} from "../screens/HomeScreen"
import { ShareFileScreen } from "../screens/ShareFileScreen";
import { DocumentsListScreen } from "../screens/DocumentsListScreen";


const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen}/>
      <Stack.Screen name="ShareFile" component={ShareFileScreen}/>
      <Stack.Screen name="DocumentsList" component={DocumentsListScreen}/>
    </Stack.Navigator>
  );
}
