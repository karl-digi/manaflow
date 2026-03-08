import { env } from "@/client-env";
import { ContainerSettings } from "@/components/ContainerSettings";
import { EditorSettingsSection } from "@/components/EditorSettingsSection";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingSection } from "@/components/settings/SettingSection";
import { SettingSegmented } from "@/components/settings/SettingSegmented";
import { SettingSelect } from "@/components/settings/SettingSelect";
import { SettingSwitch } from "@/components/settings/SettingSwitch";
import { useOnboardingOptional } from "@/contexts/onboarding";
import { isElectron } from "@/lib/electron";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import { useUser } from "@stackframe/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { z } from "zod";

const GitHubUserSchema = z.object({
  login: z.string(),
});

type HeatmapColors = {
  line: { start: string; end: string };
  token: { start: string; end: string };
};

interface Option {
  value: string;
  label: string;
}

interface GeneralSectionProps {
  teamSlugOrId: string;
  isSaving: boolean;
  teamName: string;
  originalTeamName: string;
  teamNameError: string;
  validateName: (value: string) => string;
  onTeamNameChange: (value: string) => void;
  onSaveTeamName: () => void;
  teamSlug: string;
  originalTeamSlug: string;
  teamSlugError: string;
  validateSlug: (value: string) => string;
  onTeamSlugChange: (value: string) => void;
  onSaveTeamSlug: () => void;
  selectedTheme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  autoPrEnabled: boolean;
  onAutoPrEnabledChange: (value: boolean) => void;
  heatmapModel: string;
  onHeatmapModelChange: (value: string) => void;
  heatmapModelOptions: Option[];
  heatmapThreshold: number;
  onHeatmapThresholdChange: (value: number) => void;
  heatmapTooltipLanguage: string;
  onHeatmapTooltipLanguageChange: (value: string) => void;
  tooltipLanguageOptions: Option[];
  heatmapColors: HeatmapColors;
  onHeatmapColorsChange: (colors: HeatmapColors) => void;
  worktreePath: string;
  onWorktreePathChange: (value: string) => void;
  onContainerSettingsChange: (data: {
    maxRunningContainers: number;
    reviewPeriodMinutes: number;
    autoCleanupEnabled: boolean;
    stopImmediatelyOnCompletion: boolean;
    minContainersToKeep: number;
  }) => void;
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ConnectedAccountsSection({ teamSlugOrId }: { teamSlugOrId: string }) {
  const user = useUser({ or: "return-null" });
  const [isConnecting, setIsConnecting] = useState(false);

  const { data: githubAccount, isLoading: isCheckingConnection } = useQuery({
    queryKey: ["github-connection", user?.id],
    queryFn: async () => {
      if (!user) return { connected: false, username: null };
      const account = await user.getConnectedAccount("github");
      if (!account) return { connected: false, username: null };

      try {
        const token = await account.getAccessToken();
        if (!token.accessToken) return { connected: true, username: null };

        const response = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });

        if (!response.ok) return { connected: true, username: null };

        const parsed = GitHubUserSchema.safeParse(await response.json());
        if (!parsed.success) return { connected: true, username: null };

        return { connected: true, username: parsed.data.login };
      } catch (error) {
        console.error("Failed to fetch GitHub username:", error);
        return { connected: true, username: null };
      }
    },
    enabled: !!user,
  });

  const githubConnected = isCheckingConnection
    ? null
    : (githubAccount?.connected ?? false);
  const githubUsername = githubAccount?.username ?? null;

  const handleConnectGitHub = useCallback(async () => {
    if (!user) return;

    setIsConnecting(true);
    try {
      if (isElectron) {
        const oauthUrl = `${WWW_ORIGIN}/handler/connect-github?team=${encodeURIComponent(teamSlugOrId)}`;
        window.open(oauthUrl, "_blank", "noopener,noreferrer");
        return;
      }

      await user.getConnectedAccount("github", { or: "redirect" });
    } catch (error) {
      console.error("Failed to connect GitHub:", error);
    } finally {
      setIsConnecting(false);
    }
  }, [teamSlugOrId, user]);

  if (!user) {
    return null;
  }

  return (
    <SettingSection
      title="Connected Accounts"
      description="Connect accounts to enable private repositories and higher API limits."
    >
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
              <GitHubIcon className="h-4 w-4 text-neutral-700 dark:text-neutral-300" />
            </span>
            GitHub
          </span>
        }
        description={
          githubConnected === null
            ? "Checking account status..."
            : githubConnected
              ? `Connected${githubUsername ? ` as @${githubUsername}` : ""}`
              : "Required for private repository access and improved GitHub API limits"
        }
        noBorder
      >
        {githubConnected === false ? (
          <button
            type="button"
            onClick={() => void handleConnectGitHub()}
            disabled={isConnecting}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </button>
        ) : githubConnected === true ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
            Connected
          </span>
        ) : null}
      </SettingRow>
    </SettingSection>
  );
}

function OnboardingTourSection({ teamSlugOrId }: { teamSlugOrId: string }) {
  const onboarding = useOnboardingOptional();
  const navigate = useNavigate();

  const handleStartTour = useCallback(async () => {
    if (!onboarding) return;

    onboarding.resetOnboarding();

    try {
      await navigate({
        to: "/$teamSlugOrId/dashboard",
        params: { teamSlugOrId },
      });
    } catch (error) {
      console.error("Failed to navigate to dashboard for onboarding:", error);
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    onboarding.startOnboarding();
  }, [navigate, onboarding, teamSlugOrId]);

  return (
    <SettingSection title="Getting Started">
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <HelpCircle className="h-4 w-4" aria-hidden />
            </span>
            Product Tour
          </span>
        }
        description="Take a guided tour of cmux to learn the workflow and major features."
        noBorder
      >
        <button
          type="button"
          onClick={() => void handleStartTour()}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
        >
          Start Tour
        </button>
      </SettingRow>
    </SettingSection>
  );
}

export function GeneralSection({
  teamSlug,
  teamSlugError,
  teamName,
  teamNameError,
  heatmapModel,
  heatmapColors,
  isSaving,
  selectedTheme,
  heatmapThreshold,
  worktreePath,
  autoPrEnabled,
  originalTeamSlug,
  originalTeamName,
  teamSlugOrId,
  validateName,
  validateSlug,
  heatmapModelOptions,
  heatmapTooltipLanguage,
  tooltipLanguageOptions,
  onTeamSlugChange,
  onTeamNameChange,
  onThemeChange,
  onSaveTeamSlug,
  onSaveTeamName,
  onWorktreePathChange,
  onAutoPrEnabledChange,
  onContainerSettingsChange,
  onHeatmapModelChange,
  onHeatmapColorsChange,
  onHeatmapThresholdChange,
  onHeatmapTooltipLanguageChange,
}: GeneralSectionProps) {
  return (
    <div className="space-y-4">
      <SettingSection title="Team">
        <SettingRow
          label="Team Name"
          description="How your team is displayed across cmux."
        >
          <div className="w-full space-y-2 sm:w-[26rem]">
            <input
              type="text"
              id="teamName"
              value={teamName}
              onChange={(event) => onTeamNameChange(event.target.value)}
              placeholder="Your Team"
              aria-invalid={teamNameError ? true : undefined}
              aria-describedby={teamNameError ? "team-name-error" : undefined}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 dark:bg-neutral-900 dark:text-neutral-100 ${
                teamNameError
                  ? "border-red-500 focus:ring-red-500"
                  : "border-neutral-300 focus:ring-blue-500 dark:border-neutral-700"
              }`}
            />
            {teamNameError ? (
              <p
                id="team-name-error"
                className="text-xs text-red-600 dark:text-red-500"
              >
                {teamNameError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                disabled={
                  isSaving ||
                  teamName.trim() === originalTeamName.trim() ||
                  Boolean(teamNameError) ||
                  validateName(teamName) !== ""
                }
                onClick={onSaveTeamName}
              >
                Save
              </button>
            </div>
          </div>
        </SettingRow>

        <SettingRow
          label="Team URL"
          description="Set the slug used in links. Lowercase letters, numbers, and hyphens only."
          noBorder
        >
          <div className="w-full space-y-2 sm:w-[26rem]">
            <div
              className={`inline-flex w-full items-center overflow-hidden rounded-lg border bg-white dark:bg-neutral-900 ${
                teamSlugError
                  ? "border-red-500"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              <span className="select-none border-r border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
                cmux.dev/
              </span>
              <input
                id="teamSlug"
                aria-label="Team slug"
                type="text"
                value={teamSlug}
                onChange={(event) => onTeamSlugChange(event.target.value)}
                placeholder="your-team"
                aria-invalid={teamSlugError ? true : undefined}
                aria-describedby={teamSlugError ? "team-slug-error" : undefined}
                className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-neutral-900 outline-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:text-neutral-100"
              />
            </div>
            {teamSlugError ? (
              <p
                id="team-slug-error"
                className="text-xs text-red-600 dark:text-red-500"
              >
                {teamSlugError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                disabled={
                  isSaving ||
                  teamSlug.trim() === originalTeamSlug.trim() ||
                  Boolean(teamSlugError) ||
                  validateSlug(teamSlug) !== ""
                }
                onClick={onSaveTeamSlug}
              >
                Save
              </button>
            </div>
          </div>
        </SettingRow>
      </SettingSection>

      <ConnectedAccountsSection teamSlugOrId={teamSlugOrId} />

      <SettingSection title="Appearance">
        <SettingSegmented
          label="Theme"
          description="Choose how cmux looks."
          value={selectedTheme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
          onValueChange={(value) =>
            onThemeChange(value as "light" | "dark" | "system")
          }
          noBorder
        />
      </SettingSection>

      <OnboardingTourSection teamSlugOrId={teamSlugOrId} />

      <SettingSection title="Crown Evaluator">
        <SettingSwitch
          label="Auto-create pull request with the best diff"
          description="After all agents finish, automatically create a pull request with the winning solution."
          ariaLabel="Auto-create pull request with the best diff"
          isSelected={autoPrEnabled}
          onValueChange={onAutoPrEnabledChange}
          noBorder
        />
      </SettingSection>

      <SettingSection title="Diff Heatmap Review">
        <SettingSelect
          id="heatmapModel"
          label="Review Model"
          description="AI model used to analyze diffs and highlight risky lines."
          value={heatmapModel}
          onValueChange={onHeatmapModelChange}
          options={heatmapModelOptions}
        />

        <SettingSelect
          id="heatmapTooltipLanguage"
          label="Tooltip Language"
          description="Language used in heatmap review comments."
          value={heatmapTooltipLanguage}
          onValueChange={onHeatmapTooltipLanguageChange}
          options={tooltipLanguageOptions}
        />

        <SettingRow
          label={`Visibility Threshold: ${Math.round(heatmapThreshold * 100)}%`}
          description="Show highlights only for lines above this confidence threshold."
        >
          <div className="w-full sm:w-80">
            <input
              type="range"
              id="heatmapThreshold"
              min="0"
              max="1"
              step="0.05"
              value={heatmapThreshold}
              onChange={(event) =>
                onHeatmapThresholdChange(Number.parseFloat(event.target.value))
              }
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-blue-600 dark:bg-neutral-700"
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Heatmap Colors"
          description="Customize line and token gradient colors."
          noBorder
        >
          <div className="grid w-full gap-4 sm:w-[30rem] sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Line Background
              </p>
              <div className="flex items-center gap-2">
                <span className="w-8 text-xs text-neutral-500 dark:text-neutral-400">
                  Low
                </span>
                <input
                  type="color"
                  value={heatmapColors.line.start}
                  onChange={(event) =>
                    onHeatmapColorsChange({
                      ...heatmapColors,
                      line: {
                        ...heatmapColors.line,
                        start: event.target.value,
                      },
                    })
                  }
                  className="h-8 w-8 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
                />
                <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {heatmapColors.line.start}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 text-xs text-neutral-500 dark:text-neutral-400">
                  High
                </span>
                <input
                  type="color"
                  value={heatmapColors.line.end}
                  onChange={(event) =>
                    onHeatmapColorsChange({
                      ...heatmapColors,
                      line: {
                        ...heatmapColors.line,
                        end: event.target.value,
                      },
                    })
                  }
                  className="h-8 w-8 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
                />
                <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {heatmapColors.line.end}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Token Highlight
              </p>
              <div className="flex items-center gap-2">
                <span className="w-8 text-xs text-neutral-500 dark:text-neutral-400">
                  Low
                </span>
                <input
                  type="color"
                  value={heatmapColors.token.start}
                  onChange={(event) =>
                    onHeatmapColorsChange({
                      ...heatmapColors,
                      token: {
                        ...heatmapColors.token,
                        start: event.target.value,
                      },
                    })
                  }
                  className="h-8 w-8 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
                />
                <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {heatmapColors.token.start}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 text-xs text-neutral-500 dark:text-neutral-400">
                  High
                </span>
                <input
                  type="color"
                  value={heatmapColors.token.end}
                  onChange={(event) =>
                    onHeatmapColorsChange({
                      ...heatmapColors,
                      token: {
                        ...heatmapColors.token,
                        end: event.target.value,
                      },
                    })
                  }
                  className="h-8 w-8 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
                />
                <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {heatmapColors.token.end}
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Preview
              </p>
              <div
                className="mt-1 h-4 rounded"
                style={{
                  background: `linear-gradient(to right, ${heatmapColors.line.start}, ${heatmapColors.line.end})`,
                }}
              />
            </div>
          </div>
        </SettingRow>
      </SettingSection>

      {!env.NEXT_PUBLIC_WEB_MODE ? (
        <SettingSection title="Worktree Settings">
          <SettingRow
            label="Worktree path pattern"
            description="Custom path for worktrees. Use ~ for home directory."
            noBorder
          >
            <div className="w-full sm:w-[30rem]">
              <input
                type="text"
                id="worktreePath"
                value={worktreePath}
                onChange={(event) => onWorktreePathChange(event.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                placeholder="~/.cmux/worktrees/"
                autoComplete="off"
              />
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Default location: ~/.cmux/worktrees/
              </p>
            </div>
          </SettingRow>
        </SettingSection>
      ) : null}

      {!env.NEXT_PUBLIC_WEB_MODE ? (
        <SettingSection title="Container Management">
          <div className="p-4">
            <ContainerSettings
              teamSlugOrId={teamSlugOrId}
              onDataChange={onContainerSettingsChange}
            />
          </div>
        </SettingSection>
      ) : (
        <EditorSettingsSection teamSlugOrId={teamSlugOrId} />
      )}
    </div>
  );
}
