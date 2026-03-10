import { createContext, useContext } from "react";

type OnboardingContextValue = {
  onComplete: () => void;
};

export const OnboardingContext = createContext<OnboardingContextValue>({
  onComplete: () => {},
});

export function useOnboarding() {
  return useContext(OnboardingContext);
}
