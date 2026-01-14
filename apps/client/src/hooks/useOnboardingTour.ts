import { useCallback, useEffect, useState } from "react";

export interface TourStep {
  id: string;
  target: string; // CSS selector for the element to highlight
  title: string;
  description: string;
  placement?: "top" | "bottom" | "left" | "right";
  // Optional: only show this step if condition is met
  condition?: () => boolean;
}

export interface UseOnboardingTourOptions {
  steps: TourStep[];
  storageKey?: string;
  onComplete?: () => void;
  onSkip?: () => void;
}

export interface UseOnboardingTourReturn {
  isActive: boolean;
  currentStep: TourStep | null;
  currentStepIndex: number;
  totalSteps: number;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  goToStep: (index: number) => void;
  hasCompletedTour: boolean;
  resetTour: () => void;
}

const ONBOARDING_TOUR_COMPLETED_KEY = "cmux-onboarding-tour-completed";

export function useOnboardingTour({
  steps,
  storageKey = ONBOARDING_TOUR_COMPLETED_KEY,
  onComplete,
  onSkip,
}: UseOnboardingTourOptions): UseOnboardingTourReturn {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasCompletedTour, setHasCompletedTour] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(storageKey) === "true";
  });

  // Filter steps based on conditions
  const activeSteps = steps.filter((step) => !step.condition || step.condition());

  const currentStep = isActive ? activeSteps[currentStepIndex] ?? null : null;

  const startTour = useCallback(() => {
    setCurrentStepIndex(0);
    setIsActive(true);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStepIndex < activeSteps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      // Last step, complete the tour
      setIsActive(false);
      setHasCompletedTour(true);
      localStorage.setItem(storageKey, "true");
      onComplete?.();
    }
  }, [currentStepIndex, activeSteps.length, storageKey, onComplete]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const skipTour = useCallback(() => {
    setIsActive(false);
    setHasCompletedTour(true);
    localStorage.setItem(storageKey, "true");
    onSkip?.();
  }, [storageKey, onSkip]);

  const completeTour = useCallback(() => {
    setIsActive(false);
    setHasCompletedTour(true);
    localStorage.setItem(storageKey, "true");
    onComplete?.();
  }, [storageKey, onComplete]);

  const goToStep = useCallback(
    (index: number) => {
      if (index >= 0 && index < activeSteps.length) {
        setCurrentStepIndex(index);
      }
    },
    [activeSteps.length]
  );

  const resetTour = useCallback(() => {
    localStorage.removeItem(storageKey);
    setHasCompletedTour(false);
    setCurrentStepIndex(0);
    setIsActive(false);
  }, [storageKey]);

  // Handle escape key to skip tour
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        skipTour();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        nextStep();
      } else if (e.key === "ArrowLeft") {
        prevStep();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, skipTour, nextStep, prevStep]);

  return {
    isActive,
    currentStep,
    currentStepIndex,
    totalSteps: activeSteps.length,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
    goToStep,
    hasCompletedTour,
    resetTour,
  };
}
