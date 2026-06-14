import React, { createContext, useContext, useEffect, useState } from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { AppState, Platform } from "react-native";

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

    // Native: NetInfo can hold a stale `false` after the device reconnects (it
    // doesn't reliably re-emit, especially across app backgrounding), which
    // leaves the offline banner stuck. Prime the state immediately, and force a
    // fresh read whenever the app returns to the foreground.
    const apply = (netState: NetInfoState) =>
      setState({ isConnected: netState.isConnected ?? true });

    NetInfo.fetch().then(apply);
    const unsubscribe = NetInfo.addEventListener(apply);
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") NetInfo.refresh().then(apply);
    });
    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, []);

  return (
    <NetworkContext.Provider value={state}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
