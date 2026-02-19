import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AppStackParamList } from "./appTypes";

import { HomeScreen } from "../screens/App/HomeScreen";
import { ShareScreen } from "../screens/App/ShareScreen";
import { TimelineScreen } from "../screens/App/TimelineScreen";
import { ManageDocumentsScreen } from "../screens/App/ManageDocumentsScreen";
import { TimelineEventDetailsScreen } from "../screens/App/TimelineEventDetailsScreen";
import { PreVisitNoteScreen } from "../screens/App/PreVisitNoteScreen";

import { colors } from "../theme/tokens";
import HealthSummaryScreen from "../screens/App/HealthSummaryScreen";

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: 15, fontWeight: "800", color: colors.text },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="ManageDocuments" component={ManageDocumentsScreen} />
      <Stack.Screen name="Share" component={ShareScreen} />
      <Stack.Screen name="Timeline" component={TimelineScreen} options={{ title: "Timeline" }} />
      <Stack.Screen name="HealthSummary" component={HealthSummaryScreen} />

      <Stack.Screen
        name="PreVisitNote"
        component={PreVisitNoteScreen}
        options={{ title: "Pre-Visit Note" }}
      />

      <Stack.Screen
        name="Details"
        component={TimelineEventDetailsScreen}
        options={{ title: "Timeline" }}
      />
    </Stack.Navigator>
  );
}
