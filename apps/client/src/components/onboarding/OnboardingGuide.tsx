import { env } from "@/client-env";
import { GitHubIcon } from "@/components/icons/github";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@cmux/convex/api";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Layers,
  PlayCircle,
  Server,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

export interface OnboardingGuideProps {
  teamSlugOrId: string;
  hasGithubConnection: boolean;
  hasRepos: boolean;
  hasEnvironments: boolean;
  className?: string;
}

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  badge: string;
  icon: ReactNode;
  completed: boolean;
  actionLabel: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
};

export function OnboardingGuide({
  teamSlugOrId,
  hasGithubConnection,
  hasRepos,
  hasEnvironments,
  className,
}: OnboardingGuideProps) {
  const shouldRender = !hasGithubConnection || !hasRepos || !hasEnvironments;
  const [isEnvDialogOpen, setIsEnvDialogOpen] = useState(false);
  const [isProcessDialogOpen, setIsProcessDialogOpen] = useState(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const mintState = useMutation(api.github_app.mintInstallState);

  const invalidateData = useCallback(() => {
    const queryClient = router.options.context?.queryClient;
    queryClient?.invalidateQueries();
  }, [router]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (
        data &&
        typeof data === "object" &&
        (data as { type?: string }).type === "cmux/github-install-complete"
      ) {
        invalidateData();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [invalidateData]);

  const openCenteredPopup = useCallback(
    (
      url: string,
      options: { name?: string; width?: number; height?: number } = {},
      onClose?: () => void,
    ) => {
      const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
      const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
      const windowWidth = window.innerWidth ?? document.documentElement.clientWidth;
      const windowHeight = window.innerHeight ?? document.documentElement.clientHeight;
      const width = options.width ?? 900;
      const height = options.height ?? 820;
      const left = dualScreenLeft + (windowWidth - width) / 2;
      const top = dualScreenTop + Math.max(0, (windowHeight - height) / 2);
      const features = [
        `scrollbars=yes`,
        `width=${Math.round(width)}`,
        `height=${Math.round(height)}`,
        `top=${Math.round(top)}`,
        `left=${Math.round(left)}`,
      ].join(",");
      const win = window.open(url, options.name ?? "cmux-connect-github", features);
      if (onClose && win) {
        const timer = window.setInterval(() => {
          try {
            if (win.closed) {
              window.clearInterval(timer);
              onClose();
            }
          } catch (error) {
            console.debug("GitHub popup watcher error", error);
          }
        }, 600);
      }
      return win;
    },
    []
  );

  const handleConnectGithub = useCallback(async () => {
    if (!env.NEXT_PUBLIC_GITHUB_APP_SLUG) {
      toast.error("GitHub app configuration missing");
      return;
    }
    setIsConnectingGithub(true);
    try {
      const slug = env.NEXT_PUBLIC_GITHUB_APP_SLUG;
      const baseUrl = `https://github.com/apps/${slug}/installations/new`;
      const { state } = await mintState({ teamSlugOrId });
      const sep = baseUrl.includes("?") ? "&" : "?";
      const url = `${baseUrl}${sep}state=${encodeURIComponent(state)}`;
      const popup = openCenteredPopup(url, { name: "github-install" }, () => {
        invalidateData();
      });
      popup?.focus?.();
    } catch (error) {
      console.error("Failed to start GitHub installation", error);
      toast.error("Could not open GitHub install. Try again.");
    } finally {
      setIsConnectingGithub(false);
    }
  }, [invalidateData, mintState, openCenteredPopup, teamSlugOrId]);

  const handleOpenRepoSelection = useCallback(() => {
    void navigate({
      to: "/$teamSlugOrId/environments/new",
      params: { teamSlugOrId },
      search: {
        step: "select",
        selectedRepos: [],
        connectionLogin: undefined,
        repoSearch: undefined,
        instanceId: undefined,
        snapshotId: undefined,
      },
    });
  }, [navigate, teamSlugOrId]);

  const handleOpenEnvironmentList = useCallback(() => {
    void navigate({
      to: "/$teamSlugOrId/environments",
      params: { teamSlugOrId },
      search: {
        step: undefined,
        selectedRepos: undefined,
        connectionLogin: undefined,
        repoSearch: undefined,
        instanceId: undefined,
        snapshotId: undefined,
      },
    });
  }, [navigate, teamSlugOrId]);

  const steps: OnboardingStep[] = useMemo(
    () => [
      {
        id: "github",
        title: "Connect GitHub",
        description:
          "Install the cmux GitHub App and authorize the orgs or repos you plan to automate.",
        badge: "Step 1",
        icon: (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900/5 dark:bg-white/10">
            <GitHubIcon className="h-5 w-5 text-neutral-900 dark:text-white" />
          </div>
        ),
        completed: hasGithubConnection,
        actionLabel: hasGithubConnection ? "GitHub connected" : "Connect GitHub",
        onAction: hasGithubConnection ? undefined : handleConnectGithub,
        actionDisabled: isConnectingGithub || hasGithubConnection,
      },
      {
        id: "repos",
        title: "Add repositories",
        description:
          "Pick the repos cmux should watch so tasks can pull branches, sync PRs, and launch workspaces.",
        badge: "Step 2",
        icon: (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <Sparkles className="h-5 w-5" />
          </div>
        ),
        completed: hasRepos,
        actionLabel: hasRepos ? "Repos linked" : "Select repositories",
        onAction: hasRepos ? handleOpenEnvironmentList : handleOpenRepoSelection,
        actionDisabled: !hasGithubConnection,
      },
      {
        id: "environments",
        title: "Configure environments",
        description:
          "Bundle repos, scripts, and snapshots into reusable sandboxes so every run launches ready-to-verify.",
        badge: "Step 3",
        icon: (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/10 text-sky-600">
            <Server className="h-5 w-5" />
          </div>
        ),
        completed: hasEnvironments,
        actionLabel: hasEnvironments ? "View environments" : "Create environment",
        onAction: hasEnvironments
          ? handleOpenEnvironmentList
          : handleOpenRepoSelection,
        secondaryLabel: "What is this?",
        onSecondaryAction: () => setIsEnvDialogOpen(true),
      },
    ],
    [
      handleConnectGithub,
      handleOpenEnvironmentList,
      handleOpenRepoSelection,
      hasEnvironments,
      hasGithubConnection,
      hasRepos,
      isConnectingGithub,
    ]
  );

  const completedSteps = steps.filter((step) => step.completed).length;
  const progress = Math.round((completedSteps / steps.length) * 100);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={cn(
        "mb-8 rounded-[32px] border border-neutral-200/70 bg-white/90 p-6 shadow-[0_15px_60px_rgba(15,23,42,0.12)] backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-900/80",
        className
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
            Guided setup
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Connect GitHub, add repos, then ship
          </h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            We front-load integration so every cmux run has the right permissions, repos, and cloud sandboxes.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-600 dark:text-neutral-400">
            <span>{completedSteps} of {steps.length} done</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-neutral-900 transition-all dark:bg-white"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={cn(
              "flex h-full flex-col rounded-2xl border border-neutral-200 bg-white/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/70",
              step.completed ? "shadow-[0_12px_40px_rgba(34,197,94,0.15)]" : "shadow-sm"
            )}
          >
            <div className="flex items-start gap-3">
              {step.icon}
              <div className="flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-wide">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      step.completed
                        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    )}
                  >
                    {step.completed ? "Complete" : step.badge}
                  </span>
                  {!step.completed && (
                    <span className="text-[11px] uppercase text-neutral-400">
                      {`0${index + 1}`}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {step.title}
                </p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {step.description}
                </p>
              </div>
              {step.completed && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
              )}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                type="button"
                disabled={step.actionDisabled || step.completed || !step.onAction}
                onClick={step.onAction}
                className={cn(
                  "justify-between rounded-xl border border-neutral-900/10 bg-neutral-900 text-white hover:bg-neutral-800 dark:border-white/20 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-50",
                  step.completed && "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                  step.actionDisabled && !step.completed && "opacity-60"
                )}
              >
                <span className="text-sm font-semibold">
                  {step.actionLabel}
                </span>
                {!step.completed && <ArrowRight className="h-4 w-4" />}
              </Button>
              {step.secondaryLabel && step.onSecondaryAction ? (
                <button
                  type="button"
                  onClick={step.onSecondaryAction}
                  className="text-left text-sm font-medium text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-white"
                >
                  {step.secondaryLabel}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
        <button
          type="button"
          onClick={() => setIsEnvDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium hover:border-neutral-900 hover:text-neutral-900 dark:border-neutral-700 dark:hover:border-white dark:hover:text-white"
        >
          <Layers className="h-4 w-4" />
          What are cmux environments?
        </button>
        <button
          type="button"
          onClick={() => setIsProcessDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium hover:border-neutral-900 hover:text-neutral-900 dark:border-neutral-700 dark:hover:border-white dark:hover:text-white"
        >
          <PlayCircle className="h-4 w-4" />
          See how a run works
        </button>
      </div>

      <ExplainerDialog
        title="How cmux environments work"
        description="Environments are reproducible sandboxes that stitch together repos, scripts, and snapshots so every run boots with the right context."
        icon={<Layers className="h-5 w-5 text-sky-600" />}
        sections={[
          {
            title: "Repo bundles",
            body: "Layer multiple Git repos (monos, services, infra) into one workspace so agents can cross-edit safely.",
          },
          {
            title: "Snapshots & base images",
            body: "Start from Morph snapshots or your own golden image so dependencies, CLIs, and build caches are prewarmed.",
          },
          {
            title: "Automation scripts",
            body: "Attach setup, verify, and teardown scripts. cmux runs them automatically whenever an environment boots or tasks finish.",
          },
        ]}
        open={isEnvDialogOpen}
        onOpenChange={setIsEnvDialogOpen}
      />

      <ExplainerDialog
        title="The cmux run lifecycle"
        description="Every cmux session follows the same rhythm so parallel agents stay verifiable and merge-ready."
        icon={<BookOpen className="h-5 w-5 text-neutral-900" />}
        sections={[
          {
            title: "1. Configure context",
            body: "Select the repo or environment, lock the branch, and pick which agents (Claude, Codex, Gemini, etc.) will collaborate.",
          },
          {
            title: "2. Agents execute",
            body: "Each agent gets its own VS Code, terminal, and preview. You can watch output live or expand runs from the task list.",
          },
          {
            title: "3. Verify & ship",
            body: "Use the diff viewer, logs, and preview URLs to approve work, then open a PR or merge without leaving cmux.",
          },
        ]}
        open={isProcessDialogOpen}
        onOpenChange={setIsProcessDialogOpen}
      />

    </div>
  );
}

interface ExplainerDialogProps {
  title: string;
  description: string;
  sections: Array<{ title: string; body: string }>;
  open: boolean;
  onOpenChange: (state: boolean) => void;
  icon?: ReactNode;
}

function ExplainerDialog({
  title,
  description,
  sections,
  open,
  onOpenChange,
  icon,
}: ExplainerDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-neutral-950/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-2xl outline-none dark:border-neutral-800 dark:bg-neutral-900/95">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white">
                {icon}
              </div>
            )}
            <div>
              <Dialog.Title className="text-xl font-semibold text-neutral-900 dark:text-white">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                {description}
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            {sections.map((section) => (
              <div
                key={section.title}
                className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-800/60"
              >
                <p className="text-base font-semibold text-neutral-900 dark:text-white">
                  {section.title}
                </p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
          <Dialog.Close asChild>
            <Button
              type="button"
              className="mt-6 w-full rounded-2xl bg-neutral-900 py-3 text-base font-semibold text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
            >
              Got it
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
