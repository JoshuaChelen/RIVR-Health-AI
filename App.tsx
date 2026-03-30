import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import * as Linking from "expo-linking";

import { Sentry, captureException, setUser } from "./src/lib/sentry";
import { supabase } from "./src/lib/supabase";
import { getProfile } from "./src/lib/profile";
import { OnboardingContext } from "./src/context/OnboardingContext";
import { NetworkProvider } from "./src/context/NetworkContext";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";

import { AppNavigator } from "./src/navigation/AppNavigator";
import { AppleHealthProvider } from "./src/context/AppleHealthContext";
import { AuthNavigator } from "./src/navigation/AuthNavigator";
import { OnboardingNavigator } from "./src/navigation/OnboardingNavigator";
import { SplashScreen } from "./src/screens/SplashScreen";
import { navRef } from "./src/navigation/navRef";

const linking = {
  prefixes: ["rivrhealth://"],
  config: {
    screens: {
      Login: "auth/confirmed",
      UpdatePassword: "auth/reset",
    },
  },
};

function AppInner() {
  const { colors, colorScheme } = useTheme();
  const navTheme = useMemo(() => ({
    ...(colorScheme === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(colorScheme === "dark" ? DarkTheme : DefaultTheme).colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.teal,
    },
  }), [colorScheme, colors]);

  const [showSplash, setShowSplash] = useState(true);
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
    } catch (e) {
      captureException(e);
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

        if (session?.user) {
          setUser({ id: session.user.id, email: session.user.email });
        }

        if (event === "SIGNED_OUT") {
          setUser(null);
        }

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

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  // Show a minimal spinner if session hydration is still in progress after splash
  if (profileLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const showApp = session && !isRecoveryFlow;

  return (
    <NetworkProvider>
      <NavigationContainer ref={navRef} linking={linking} theme={navTheme}>
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
    </NetworkProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

export default Sentry.wrap(App);