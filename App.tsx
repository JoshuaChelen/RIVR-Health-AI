import { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { supabase } from "./src/lib/supabase";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { AuthNavigator } from "./src/navigation/AuthNavigator";
import { navRef } from "./src/navigation/navRef";

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        // If user clicked the reset-password email link
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryFlow(true);
        if (navRef.isReady()) {
          navRef.navigate("UpdatePassword");
        }
      }
      if (event === "SIGNED_OUT") setIsRecoveryFlow(false);
      if (event === "SIGNED_IN") setIsRecoveryFlow(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <NavigationContainer ref={navRef}>
      {session && !isRecoveryFlow ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
