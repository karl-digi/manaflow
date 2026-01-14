import { useContext } from "react";
import {
  OnboardingTourContext,
  type OnboardingTourContextValue,
} from "./onboarding-tour-context";

export function useOnboardingTourContext(): OnboardingTourContextValue {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error(
      "useOnboardingTourContext must be used within OnboardingTourProvider"
    );
  }
  return context;
}

// Export a hook that safely returns null if not in provider
export function useOnboardingTourContextSafe(): OnboardingTourContextValue | null {
  return useContext(OnboardingTourContext);
}
