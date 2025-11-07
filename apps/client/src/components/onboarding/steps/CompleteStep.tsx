import { Button } from "@/components/ui/button";
import { Check, Box, Github, FolderGit2 } from "lucide-react";

interface CompleteStepProps {
  onComplete: () => void;
  teamSlugOrId: string;
  hasGitHubConnection: boolean;
  repoCount: number;
}

export function CompleteStep({
  onComplete,
  hasGitHubConnection,
  repoCount,
}: CompleteStepProps) {
  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Setup Complete
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          You're ready to start using cmux.
        </p>
      </div>

      <div className="mb-4 space-y-2">
        <StatusItem
          icon={Github}
          label="GitHub"
          status={hasGitHubConnection}
        />
        <StatusItem
          icon={FolderGit2}
          label="Repositories"
          status={repoCount > 0}
          detail={repoCount > 0 ? `${repoCount} synced` : undefined}
        />
        <StatusItem icon={Box} label="Environments" status={false} optional />
      </div>

      <Button onClick={onComplete} size="sm" className="gap-2">
        Go to Dashboard
      </Button>
    </div>
  );
}

function StatusItem({
  icon: Icon,
  label,
  status,
  detail,
  optional = false,
}: {
  icon: typeof Github;
  label: string;
  status: boolean;
  detail?: string;
  optional?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
        status
          ? "border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20"
          : optional
            ? "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50"
            : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50"
      }`}
    >
      <div
        className={`flex h-6 w-6 items-center justify-center rounded ${
          status
            ? "bg-green-500 text-white"
            : "bg-neutral-200 text-neutral-400 dark:bg-neutral-700 dark:text-neutral-500"
        }`}
      >
        {status ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="flex-1">
        <span
          className={`text-sm font-medium ${
            status
              ? "text-green-900 dark:text-green-100"
              : "text-neutral-700 dark:text-neutral-300"
          }`}
        >
          {label}
          {optional && (
            <span className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              (Optional)
            </span>
          )}
        </span>
        {detail && (
          <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}
