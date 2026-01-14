import { OnboardingTour } from "@/components/OnboardingTour";
import { useOnboardingTour, type TourStep } from "@/hooks/useOnboardingTour";
import { useMemo, type ReactNode } from "react";
import { OnboardingTourContext } from "./onboarding-tour-context";

// Define all tour steps for the application
const TOUR_STEPS: TourStep[] = [
  {
    id: "sidebar",
    target: '[data-tour="sidebar"]',
    title: "Navigation Sidebar",
    description:
      "This is your main navigation hub. Access the dashboard, environments, and settings from here. You can resize it by dragging the edge or collapse it with Ctrl+Shift+S.",
    placement: "right",
  },
  {
    id: "dashboard-input",
    target: '[data-tour="dashboard-input"]',
    title: "Task Input",
    description:
      "Describe what you want to build or fix. You can paste images, write detailed specs, or just a quick description. Press Cmd/Ctrl+Enter to start.",
    placement: "bottom",
  },
  {
    id: "repo-picker",
    target: '[data-tour="repo-picker"]',
    title: "Repository Selection",
    description:
      "Select which GitHub repository to work on. Connect your GitHub account to access private repos, or paste any public repo URL directly.",
    placement: "bottom",
  },
  {
    id: "branch-picker",
    target: '[data-tour="branch-picker"]',
    title: "Branch Selection",
    description:
      "Choose which branch to start from. Your agents will create their changes from this base branch.",
    placement: "bottom",
  },
  {
    id: "agent-picker",
    target: '[data-tour="agent-picker"]',
    title: "Agent Selection",
    description:
      "Pick one or more AI agents to work on your task in parallel. Each agent runs independently, so you can compare their approaches and choose the best solution.",
    placement: "bottom",
  },
  {
    id: "cloud-toggle",
    target: '[data-tour="cloud-toggle"]',
    title: "Cloud vs Local Mode",
    description:
      "Cloud mode runs agents in isolated sandboxes (great for web access). Local mode uses Docker on your machine (faster, works offline). Toggle based on your needs.",
    placement: "top",
  },
  {
    id: "start-button",
    target: '[data-tour="start-button"]',
    title: "Start Your Task",
    description:
      "Once everything is configured, click here to launch your agents. They'll start working immediately and you can watch their progress in real-time.",
    placement: "top",
  },
  {
    id: "task-list",
    target: '[data-tour="task-list"]',
    title: "Task History",
    description:
      "Your tasks appear here organized by status: in progress, ready to review, and completed. Click any task to see its runs, diffs, and PR status.",
    placement: "top",
  },
  {
    id: "environments-nav",
    target: '[data-tour="environments-nav"]',
    title: "Environments",
    description:
      "Create pre-configured environments with dev scripts, environment variables, and dependencies. These let agents start coding immediately without setup time.",
    placement: "right",
  },
  {
    id: "settings-nav",
    target: '[data-tour="settings-nav"]',
    title: "Settings",
    description:
      "Configure your API keys for different AI providers, connect GitHub, and customize your workspace preferences.",
    placement: "right",
  },
];

export function OnboardingTourProvider({ children }: { children: ReactNode }) {
  const tour = useOnboardingTour({
    steps: TOUR_STEPS,
    onComplete: () => {
      console.log("Onboarding tour completed");
    },
    onSkip: () => {
      console.log("Onboarding tour skipped");
    },
  });

  const contextValue = useMemo(() => tour, [tour]);

  return (
    <OnboardingTourContext.Provider value={contextValue}>
      {children}
      <OnboardingTour
        isActive={tour.isActive}
        currentStep={tour.currentStep}
        currentStepIndex={tour.currentStepIndex}
        totalSteps={tour.totalSteps}
        onNext={tour.nextStep}
        onPrev={tour.prevStep}
        onSkip={tour.skipTour}
      />
    </OnboardingTourContext.Provider>
  );
}
