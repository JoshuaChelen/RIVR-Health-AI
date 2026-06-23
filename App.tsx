import { useCallback, useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";

import { Sentry, captureException } from "./src/lib/sentry";
import { getProfile } from "./src/lib/api/data";
import { SessionProvider, useSession } from "./src/context/SessionContext";
import { OnboardingContext } from "./src/context/OnboardingContext";
import { NetworkProvider } from "./src/context/NetworkContext";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";

import { AppNavigator } from "./src/navigation/AppNavigator";
import { AppleHealthProvider } from "./src/context/AppleHealthContext";
import { AuthNavigator } from "./src/navigation/AuthNavigator";
import { OnboardingNavigator } from "./src/navigation/OnboardingNavigator";
import { EmailVerificationScreen } from "./src/screens/Auth/EmailVerificationScreen";
import { SplashScreen } from "./src/screens/SplashScreen";
import { navRef } from "./src/navigation/navRef";
import { appLinking } from "./src/navigation/linking";

function AppInner() {
  const { colors, colorScheme } = useTheme();
  const { user, loading: sessionLoading } = useSession();

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
  const [profileLoading, setProfileLoading] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const checkOnboarding = useCallback(async () => {
    setProfileLoading(true);
    try {
      const profile = await getProfile();
      setOnboardingComplete(!!profile?.onboarding_completed_at);
    } catch (e) {
      captureException(e);
      setOnboardingComplete(false);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    // Onboarding/profile is gated behind email verification on the backend, so
    // only fetch it once the user is verified; unverified users hit the gate.
    if (user && user.is_email_verified) {
      checkOnboarding();
    } else {
      setOnboardingComplete(false);
      setProfileLoading(false);
    }
  }, [sessionLoading, user, checkOnboarding]);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (sessionLoading || (user && profileLoading)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const showApp = !!user;

  // Email-verification gate ("onboarding zero"): a logged-in user with an
  // unverified email cannot reach onboarding until they verify. Rendered
  // standalone (like the splash) — it needs no navigator.
  if (user && !user.is_email_verified) {
    return (
      <NetworkProvider>
        <EmailVerificationScreen />
      </NetworkProvider>
    );
  }

  return (
    <NetworkProvider>
      <NavigationContainer ref={navRef} linking={appLinking} theme={navTheme}>
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
      <SessionProvider>
        <AppInner />
      </SessionProvider>
    </ThemeProvider>
  );
}

export default Sentry.wrap(App);
