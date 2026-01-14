import { useOnboardingTourContextSafe } from "@/contexts/onboarding/useOnboardingTourContext";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { useEffect, useRef } from "react";

interface OnboardingTourTriggerProps {
  /** If true, automatically starts the tour for first-time users */
  autoStartForNewUsers?: boolean;
}

export function OnboardingTourTrigger({
  autoStartForNewUsers = true,
}: OnboardingTourTriggerProps) {
  const tour = useOnboardingTourContextSafe();
  const hasAutoStartedRef = useRef(false);

  // Auto-start tour for new users (only once per session)
  useEffect(() => {
    if (!autoStartForNewUsers || !tour || hasAutoStartedRef.current) return;

    // Small delay to ensure the UI is fully rendered
    const timer = setTimeout(() => {
      if (!tour.hasCompletedTour && !tour.isActive) {
        hasAutoStartedRef.current = true;
        tour.startTour();
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoStartForNewUsers, tour]);

  if (!tour) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            if (tour.hasCompletedTour) {
              tour.resetTour();
            }
            tour.startTour();
          }}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Start onboarding tour"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tour.hasCompletedTour ? "Replay tour" : "Start tour"}
      </TooltipContent>
    </Tooltip>
  );
}
