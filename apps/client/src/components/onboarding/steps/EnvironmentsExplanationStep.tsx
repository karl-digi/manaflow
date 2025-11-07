import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface EnvironmentsExplanationStepProps {
  onNext: () => void;
  teamSlugOrId: string;
}

export function EnvironmentsExplanationStep({
  onNext,
}: EnvironmentsExplanationStepProps) {
  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Workspace Modes
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Choose how you want to run your development workspaces.
        </p>
      </div>

      <div className="mb-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Local Mode
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Runs Docker containers on your machine. Fast and free, but requires Docker Desktop.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Cloud Mode
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Runs in cloud-based containers. Works without Docker, but requires an environment configuration.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Environments (Cloud Only)
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Pre-configured templates with repos, scripts, and environment variables. Set up once, reuse for every task.
          </p>
        </div>
      </div>

      {/* Placeholder for screenshot */}
      <div className="mb-4 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Screenshot placeholder
        </p>
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button onClick={onNext} size="sm" className="gap-1.5">
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
