import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AppStackParamList } from "./appTypes";

import { HomeScreen } from "../screens/App/HomeScreen";
import { ShareScreen } from "../screens/App/ShareScreen";
import { TimelineScreen } from "../screens/App/TimelineScreen";
import { ManageDocumentsScreen } from "../screens/App/ManageDocumentsScreen";
import { TimelineEventDetailsScreen } from "../screens/App/TimelineEventDetailsScreen";
import { PreVisitNoteScreen } from "../screens/App/PreVisitNoteScreen";
import HealthSummaryScreen from "../screens/App/HealthSummaryScreen";

import { colors, typescale } from "../theme/tokens";

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle:       { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle:  {
          fontSize:   typescale.size.md,
          fontWeight: typescale.weight.bold,
          color:      colors.text,
        },
        headerTintColor:   colors.teal,
        contentStyle:      { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ManageDocuments"
        component={ManageDocumentsScreen}
        options={{ title: "Documents", headerShown: false }}
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
        name="HealthSummary"
        component={HealthSummaryScreen}
        options={{ title: "Health Summary" }}
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
    </Stack.Navigator>
  );
}
