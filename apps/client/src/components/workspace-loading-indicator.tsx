import { memo, useMemo } from "react";
import { AlertTriangle, Loader2, Download, Package, CheckCircle2, HardDrive, Wifi, KeyRound, Clock, Server } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceLoadingStatus = "loading" | "error";

type WorkspaceLoadingVariant = "vscode" | "browser" | "terminal";

// Docker pull progress types
interface DockerPullProgress {
  type: "docker-pull";
  imageName: string;
  status: "starting" | "pulling" | "error";
  phase?: "downloading" | "extracting" | "verifying";
  percentage?: number;
  layerId?: string;
  layerStatus?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
  errorCode?: string;
  troubleshooting?: string[];
}

export interface WorkspaceLoadingIndicatorProps {
  status: WorkspaceLoadingStatus;
  variant?: WorkspaceLoadingVariant;
  className?: string;
  loadingTitle?: string;
  loadingDescription?: string;
  errorTitle?: string;
  errorDescription?: string;
  action?: React.ReactNode;
}

const VARIANT_COPY: Record<
  WorkspaceLoadingVariant,
  {
    loadingTitle: string;
    loadingDescription: string;
    errorTitle: string;
    errorDescription: string;
  }
> = {
  vscode: {
    loadingTitle: "Starting VS Code workspace",
    loadingDescription:
      "Provisioning an isolated editor. This usually takes under a minute.",
    errorTitle: "We couldn't launch VS Code",
    errorDescription: "Refresh the page or try rerunning the task.",
  },
  browser: {
    loadingTitle: "Launching browser preview",
    loadingDescription:
      "Preparing the in-browser environment. Available in cloud workspaces.",
    errorTitle: "We couldn't launch the browser preview",
    errorDescription: "Refresh the page or switch to cloud mode, then try again.",
  },
  terminal: {
    loadingTitle: "Starting terminal",
    loadingDescription: "Connecting to the workspace terminal session.",
    errorTitle: "We couldn't connect to the terminal",
    errorDescription: "Refresh the page or try again.",
  },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function parseDockerPullProgress(description: string | undefined): DockerPullProgress | null {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description);
    if (parsed && parsed.type === "docker-pull") {
      return parsed as DockerPullProgress;
    }
  } catch {
    // Not JSON, return null
  }
  return null;
}

function getErrorIcon(errorCode: string | undefined) {
  switch (errorCode) {
    case "DISK_SPACE":
      return HardDrive;
    case "NETWORK_ERROR":
    case "TIMEOUT":
      return Wifi;
    case "AUTH_FAILED":
      return KeyRound;
    case "RATE_LIMITED":
      return Clock;
    case "DAEMON_NOT_RUNNING":
      return Server;
    default:
      return AlertTriangle;
  }
}

function DockerPullProgressUI({ progress }: { progress: DockerPullProgress }) {
  const percentage = progress.percentage ?? 0;
  const phase = progress.phase ?? "downloading";

  const PhaseIcon = phase === "downloading" ? Download :
                    phase === "extracting" ? Package : CheckCircle2;

  const phaseLabel = phase === "downloading" ? "Downloading" :
                     phase === "extracting" ? "Extracting" : "Verifying";

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm">
      {/* Icon with animated ring */}
      <div className="relative">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 dark:bg-blue-400/10">
          <PhaseIcon className="h-7 w-7 text-blue-500 dark:text-blue-400" />
        </div>
        {/* Animated pulse ring */}
        <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 dark:border-blue-400/30 animate-ping" />
      </div>

      {/* Title and image name */}
      <div className="space-y-1 text-center">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Pulling Docker Image
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono truncate max-w-xs">
          {progress.imageName}
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                phase === "downloading" ? "bg-blue-500 animate-pulse" :
                phase === "extracting" ? "bg-amber-500 animate-pulse" :
                "bg-green-500"
              )}
            />
            {phaseLabel}
          </span>
          <span className="font-medium">{percentage}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300 ease-out",
              phase === "downloading" ? "bg-blue-500" :
              phase === "extracting" ? "bg-amber-500" :
              "bg-green-500"
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {progress.downloadedBytes !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0 && (
          <p className="text-xs text-center text-neutral-400 dark:text-neutral-500">
            {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
          </p>
        )}
      </div>

      {/* Message */}
      <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center">
        {progress.message || "This may take a few minutes on first run."}
      </p>
    </div>
  );
}

function DockerPullErrorUI({ progress }: { progress: DockerPullProgress }) {
  const ErrorIcon = getErrorIcon(progress.errorCode);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm">
      {/* Error icon */}
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 dark:bg-red-400/10 border-2 border-red-500/30 dark:border-red-400/30">
        <ErrorIcon className="h-7 w-7 text-red-500 dark:text-red-400" />
      </div>

      {/* Title and message */}
      <div className="space-y-1.5 text-center">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Docker Pull Failed
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {progress.message}
        </p>
      </div>

      {/* Troubleshooting steps */}
      {progress.troubleshooting && progress.troubleshooting.length > 0 && (
        <div className="w-full rounded-lg bg-neutral-100 dark:bg-neutral-800/50 p-3 space-y-2">
          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Troubleshooting steps:
          </p>
          <ul className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1.5 list-none">
            {progress.troubleshooting.slice(0, 3).map((step, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="flex-shrink-0 h-4 w-4 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[10px] font-medium">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Image name */}
      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono truncate max-w-xs">
        {progress.imageName}
      </p>
    </div>
  );
}

export const WorkspaceLoadingIndicator = memo(function WorkspaceLoadingIndicator({
  status,
  variant = "vscode",
  className,
  loadingTitle,
  loadingDescription,
  errorTitle,
  errorDescription,
  action,
}: WorkspaceLoadingIndicatorProps) {
  const copy = VARIANT_COPY[variant];
  const isError = status === "error";

  // Check if the description contains Docker pull progress JSON
  const dockerProgress = useMemo(
    () => parseDockerPullProgress(isError ? errorDescription : loadingDescription),
    [isError, errorDescription, loadingDescription]
  );

  // If we have Docker pull progress, show the specialized UI
  if (dockerProgress) {
    if (dockerProgress.status === "error") {
      return (
        <div className={cn("flex flex-col items-center gap-4 text-center px-6", className)}>
          <DockerPullErrorUI progress={dockerProgress} />
          {action}
        </div>
      );
    }

    return (
      <div className={cn("flex flex-col items-center gap-4 text-center px-6", className)}>
        <DockerPullProgressUI progress={dockerProgress} />
        {action}
      </div>
    );
  }

  // Standard loading/error indicator
  const Icon = isError ? AlertTriangle : Loader2;

  const resolvedTitle = isError
    ? errorTitle ?? copy.errorTitle
    : loadingTitle ?? copy.loadingTitle;

  const resolvedDescription = isError
    ? errorDescription ?? copy.errorDescription
    : loadingDescription ?? copy.loadingDescription;

  return (
    <div className={cn("flex flex-col items-center gap-4 text-center px-6", className)}>
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border-2",
          isError
            ? "border-red-500/30 text-red-500 dark:text-red-400"
            : "border-blue-500/30 text-blue-500 dark:text-blue-400",
        )}
      >
        <Icon className={cn("h-6 w-6", isError ? undefined : "animate-spin")} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {resolvedTitle}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {resolvedDescription}
        </p>
      </div>
      {action}
    </div>
  );
});
