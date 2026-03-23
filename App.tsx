import { useCallback, useEffect, useRef, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import * as Linking from "expo-linking";

import { supabase } from "./src/lib/supabase";
import { getProfile } from "./src/lib/profile";
import { OnboardingContext } from "./src/context/OnboardingContext";

import { AppNavigator } from "./src/navigation/AppNavigator";
import { AppleHealthProvider } from "./src/context/AppleHealthContext";
import { AuthNavigator } from "./src/navigation/AuthNavigator";
import { OnboardingNavigator } from "./src/navigation/OnboardingNavigator";
import { navRef } from "./src/navigation/navRef";
import { colors } from "./src/theme/tokens";

const linking = {
  prefixes: ["rivrhealth://"],
  config: {
    screens: {
      Login: "auth/confirmed",
      UpdatePassword: "auth/reset",
    },
  },
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  // Prevents the auth state change listener from re-running checkOnboarding
  // for the SIGNED_IN event that fires on initial session hydration, which would
  // duplicate the call already made by getSession().
  const didInitCheck = useRef(false);

  const checkOnboarding = useCallback(async (userId: string) => {
    try {
      const profile = await getProfile(userId);
      setOnboardingComplete(!!profile?.onboarding_completed_at);
    } catch {
      setOnboardingComplete(false);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        checkOnboarding(data.session.user.id);
      } else {
        setProfileLoading(false);
      }
      didInitCheck.current = true;
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);

        if (event === "PASSWORD_RECOVERY") {
          setIsRecoveryFlow(true);
          setProfileLoading(false);
          if (navRef.isReady()) navRef.navigate("UpdatePassword");
        } else if (event === "SIGNED_OUT") {
          setIsRecoveryFlow(false);
          setOnboardingComplete(false);
          setProfileLoading(false);
        } else if (event === "SIGNED_IN" && session && didInitCheck.current) {
          // Only re-run for genuine new sign-ins, not the initial session hydration
          setIsRecoveryFlow(false);
          setProfileLoading(true);
          checkOnboarding(session.user.id);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, [checkOnboarding]);

  // Show a minimal splash while we determine where to route the user
  if (profileLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const showApp = session && !isRecoveryFlow;

  return (
    <NavigationContainer ref={navRef} linking={linking}>
      {showApp && onboardingComplete ? (
        <AppleHealthProvider>
          <AppNavigator />
        </AppleHealthProvider>
      ) : showApp && !onboardingComplete ? (
        <OnboardingContext.Provider value={{ onComplete: () => setOnboardingComplete(true) }}>
          <OnboardingNavigator />
        </OnboardingContext.Provider>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
