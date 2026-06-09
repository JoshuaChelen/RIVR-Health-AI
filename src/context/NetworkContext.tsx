import React, { createContext, useContext, useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";

type NetworkState = {
  isConnected: boolean;
};

const NetworkContext = createContext<NetworkState>({
  isConnected: true,
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NetworkState>({
    isConnected: true,
  });

  useEffect(() => {
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      const updateWebNetworkState = () => {
        setState({
          isConnected: navigator.onLine,
        });
      };

      updateWebNetworkState();
      window.addEventListener("online", updateWebNetworkState);
      window.addEventListener("offline", updateWebNetworkState);

      return () => {
        window.removeEventListener("online", updateWebNetworkState);
        window.removeEventListener("offline", updateWebNetworkState);
      };
    }

    const unsubscribe = NetInfo.addEventListener((netState) => {
      setState({
        isConnected: netState.isConnected ?? true,
      });
    });
    return unsubscribe;
  }, []);

  return (
    <NetworkContext.Provider value={state}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
