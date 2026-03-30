import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { OnboardingStackParamList } from "./onboardingTypes";

import { OnboardingStep1Screen } from "../screens/Onboarding/OnboardingStep1Screen";
import { OnboardingStep2Screen } from "../screens/Onboarding/OnboardingStep2Screen";
import { OnboardingStep3Screen } from "../screens/Onboarding/OnboardingStep3Screen";
import { useTheme } from "../context/ThemeContext";

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="OnboardingStep1"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="OnboardingStep1" component={OnboardingStep1Screen} />
      <Stack.Screen name="OnboardingStep2" component={OnboardingStep2Screen} />
      <Stack.Screen name="OnboardingStep3" component={OnboardingStep3Screen} />
    </Stack.Navigator>
  );
}
