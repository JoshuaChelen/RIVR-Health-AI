import React, { createContext, useContext, useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";

type NetworkState = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
};

const NetworkContext = createContext<NetworkState>({
  isConnected: true,
  isInternetReachable: null,
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NetworkState>({
    isConnected: true,
    isInternetReachable: null,
  });

  useEffect(() => {
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      const updateWebNetworkState = () => {
        setState({
          isConnected: navigator.onLine,
          isInternetReachable: navigator.onLine,
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
        isInternetReachable: netState.isInternetReachable ?? null,
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
