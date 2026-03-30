// src/navigation/AuthNavigator.tsx
import React, { useEffect, useState } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthStackParamList } from "./authTypes";
import { WelcomeScreen } from "../screens/Auth/WelcomeScreen";
import { LoginScreen } from "../screens/Auth/LoginScreen";
import { SignUpScreen } from "../screens/Auth/SignUpScreen";
import { typescale } from "../theme/tokens";
import { useTheme } from "../context/ThemeContext";
import { ForgotPasswordScreen } from "../screens/Auth/ForgotPasswordScreen";
import { UpdatePasswordScreen } from "../screens/Auth/UpdatePasswordScreen";

const WELCOME_KEY = "rivr_welcome_seen";
const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  const { colors } = useTheme();
  const [initialRoute, setInitialRoute] = useState<keyof AuthStackParamList | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(WELCOME_KEY).then((val) => {
      setInitialRoute(val === "true" ? "Login" : "Welcome");
    });
  }, []);

  // Don't render until we know the initial route
  if (!initialRoute) return null;

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        // This hides the header across all auth screens
        headerShown: false,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: typescale.size.md, fontWeight: typescale.weight.bold, color: colors.text },
        headerTintColor: colors.text,
        // contentStyle is still vital here to ensure the background color matches your theme
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="UpdatePassword" component={UpdatePasswordScreen} />
    </Stack.Navigator>
  );
}