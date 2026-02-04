// src/navigation/AuthNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "./authTypes";
import { LoginScreen } from "../screens/Auth/LoginScreen";
import { SignUpScreen } from "../screens/Auth/SignUpScreen";
import { colors } from "../theme/tokens";

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        // This hides the header across all auth screens
        headerShown: false, 
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: 15, fontWeight: "800", color: colors.text },
        headerTintColor: colors.text,
        // contentStyle is still vital here to ensure the background color matches your theme
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}