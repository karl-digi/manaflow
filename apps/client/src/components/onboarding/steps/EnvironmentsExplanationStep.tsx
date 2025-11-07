import { Button } from "@/components/ui/button";
import { ArrowRight, Box } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface EnvironmentsExplanationStepProps {
  onNext: () => void;
  teamSlugOrId: string;
}

export function EnvironmentsExplanationStep({
  onNext,
  teamSlugOrId,
}: EnvironmentsExplanationStepProps) {
  const navigate = useNavigate();

  const handleCreateEnvironment = () => {
    navigate({
      to: "/$teamSlugOrId/environments/new",
      params: { teamSlugOrId },
      search: {
        step: "select" as const,
        selectedRepos: [],
        connectionLogin: undefined,
        repoSearch: undefined,
        instanceId: undefined,
        snapshotId: undefined,
      },
    });
  };

  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Environments (Optional)
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Environments are isolated workspaces where agents work on tasks.
        </p>
      </div>

      <div className="mb-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
        <p>Each environment:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Runs in an isolated container with VSCode</li>
          <li>Manages Git branches and pull requests</li>
          <li>Runs custom scripts for development</li>
        </ul>
      </div>

      <Button
        variant="outline"
        onClick={handleCreateEnvironment}
        size="sm"
        className="mb-4 gap-2"
      >
        <Box className="h-4 w-4" />
        Create Environment
      </Button>

      <div className="flex items-center justify-end pt-2">
        <Button onClick={onNext} size="sm" className="gap-1.5">
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
