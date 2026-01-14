import { createContext } from "react";
import type { UseOnboardingTourReturn } from "@/hooks/useOnboardingTour";

export type OnboardingTourContextValue = UseOnboardingTourReturn;

export const OnboardingTourContext =
  createContext<OnboardingTourContextValue | null>(null);
