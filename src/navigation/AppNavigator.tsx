import React from "react";
import { Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AppStackParamList } from "./appTypes";
import Ionicons from "@expo/vector-icons/Ionicons";

import { HomeScreen } from "../screens/App/HomeScreen";
import { ProfileScreen } from "../screens/App/ProfileScreen";
import { MedicalProfileScreen } from "../screens/App/MedicalProfileScreen";
import { StoryScreen } from "../screens/App/StoryScreen";
import { ShareScreen } from "../screens/App/ShareScreen";
import { TimelineScreen } from "../screens/App/TimelineScreen";
import { ManageDocumentsScreen } from "../screens/App/ManageDocumentsScreen";
import { TimelineEventDetailsScreen } from "../screens/App/TimelineEventDetailsScreen";
import { PreVisitNoteScreen } from "../screens/App/PreVisitNoteScreen";
import HealthSummaryScreen from "../screens/App/HealthSummaryScreen";
import { AIInsightsScreen } from "../screens/App/AIInsightsScreen";
import { ShinScoreScreen } from "../screens/App/ShinScoreScreen";
import { AppleHealthScreen } from "../screens/App/AppleHealthScreen";

import { colors, typescale } from "../theme/tokens";

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={({ navigation }) => ({
        headerStyle:       { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle:  {
          fontSize:      typescale.size.md,
          fontWeight:    typescale.weight.semibold,
          color:         colors.text,
          letterSpacing: -0.2,
        },
        headerTintColor:          colors.teal,
        contentStyle:             { backgroundColor: colors.bg },
        headerBackVisible:        false,
        headerBackTitleVisible:   false,
        headerBackButtonMenuEnabled: false,
        headerLeft: ({ canGoBack }) =>
          canGoBack ? (
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={8}
              style={({ pressed }) => [
                {
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "transparent",
                  borderWidth: 0,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color={colors.teal}
                style={{ marginLeft: -1 }}
              />
            </Pressable>
          ) : null,
      })}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ManageDocuments"
        component={ManageDocumentsScreen}
        options={{ title: "Documents" }}
      />
      <Stack.Screen
        name="Share"
        component={ShareScreen}
        options={{ title: "Share Records" }}
      />
      <Stack.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{ title: "Timeline" }}
      />
      <Stack.Screen
        name="ShinScore"
        component={ShinScoreScreen}
        options={{ title: "SHIN Score" }}
      />
      <Stack.Screen
        name="HealthSummary"
        component={HealthSummaryScreen}
        options={{ title: "AI Health Summary" }}
      />
      <Stack.Screen
        name="AIInsights"
        component={AIInsightsScreen}
        options={{ title: "AI Recommendations" }}
      />
      <Stack.Screen
        name="PreVisitNote"
        component={PreVisitNoteScreen}
        options={{ title: "Pre-Visit Note" }}
      />
      <Stack.Screen
        name="Details"
        component={TimelineEventDetailsScreen}
        options={{ title: "Event Details" }}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "My Profile" }}
      />
      <Stack.Screen
        name="MedicalProfile"
        component={MedicalProfileScreen}
        options={{ title: "Medical Profile" }}
      />
      <Stack.Screen
        name="Story"
        component={StoryScreen}
        options={{ title: "Your Health Story" }}
      />
      <Stack.Screen
        name="AppleHealth"
        component={AppleHealthScreen}
        options={{ title: "Apple Health" }}
      />
    </Stack.Navigator>
  );
}
