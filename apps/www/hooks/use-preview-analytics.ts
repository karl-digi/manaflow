"use client";

import { useCallback, useRef } from "react";
import posthog from "posthog-js";

// ============================================================================
// Client-side PostHog Analytics Hook for Preview.new
// ============================================================================

type PreviewAnalyticsContext = {
  teamSlugOrId?: string;
  repoFullName?: string;
};

/**
 * Hook providing client-side analytics tracking for preview.new
 * Uses PostHog JS SDK for immediate event capture
 */
export function usePreviewAnalytics(context: PreviewAnalyticsContext = {}) {
  const contextRef = useRef(context);
  contextRef.current = context;

  // Track page/view events
  const trackPageView = useCallback(
    (
      page: "dashboard" | "configure",
      properties?: Record<string, unknown>
    ) => {
      posthog.capture(`preview_${page}_viewed`, {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        ...properties,
      });
    },
    []
  );

  // Track framework selection
  const trackFrameworkSelected = useCallback(
    (frameworkPreset: string, isAutoDetected: boolean) => {
      posthog.capture("preview_framework_selected", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        framework_preset: frameworkPreset,
        is_auto_detected: isAutoDetected,
      });
    },
    []
  );

  // Track machine preset selection
  const trackMachinePresetSelected = useCallback((machinePreset: string) => {
    posthog.capture("preview_machine_preset_selected", {
      team_slug_or_id: contextRef.current.teamSlugOrId,
      repo_full_name: contextRef.current.repoFullName,
      machine_preset: machinePreset,
    });
  }, []);

  // Track env vars configured
  const trackEnvVarsConfigured = useCallback(
    (envVarCount: number, hasSecrets: boolean) => {
      posthog.capture("preview_env_vars_configured", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        env_var_count: envVarCount,
        has_secrets: hasSecrets,
      });
    },
    []
  );

  // Track scripts configured
  const trackScriptsConfigured = useCallback(
    (hasMaintenanceScript: boolean, hasDevScript: boolean) => {
      posthog.capture("preview_scripts_configured", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        has_maintenance_script: hasMaintenanceScript,
        has_dev_script: hasDevScript,
      });
    },
    []
  );

  // Track setup step navigation
  const trackSetupStepEntered = useCallback(
    (step: "scripts" | "env-vars" | "run-scripts" | "browser-setup") => {
      posthog.capture("preview_setup_step_entered", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        step,
      });
    },
    []
  );

  // Track setup step completion
  const trackSetupStepCompleted = useCallback(
    (
      step: "scripts" | "env-vars" | "run-scripts" | "browser-setup",
      stepNumber: number
    ) => {
      posthog.capture("preview_setup_step_completed", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        step,
        step_number: stepNumber,
      });
    },
    []
  );

  // Track workspace started
  const trackWorkspaceStarted = useCallback((snapshotId: string) => {
    posthog.capture("preview_workspace_started", {
      team_slug_or_id: contextRef.current.teamSlugOrId,
      repo_full_name: contextRef.current.repoFullName,
      snapshot_id: snapshotId,
    });
  }, []);

  // Track workspace ready
  const trackWorkspaceReady = useCallback(
    (snapshotId: string, provisionDurationMs: number) => {
      posthog.capture("preview_workspace_ready", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        snapshot_id: snapshotId,
        provision_duration_ms: provisionDurationMs,
      });
    },
    []
  );

  // Track configuration saved
  const trackConfigurationSaved = useCallback(
    (config: {
      frameworkPreset: string;
      machinePreset: string;
      envVarCount: number;
      hasMaintenanceScript: boolean;
      hasDevScript: boolean;
    }) => {
      posthog.capture("preview_configuration_saved", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        framework_preset: config.frameworkPreset,
        machine_preset: config.machinePreset,
        env_var_count: config.envVarCount,
        has_maintenance_script: config.hasMaintenanceScript,
        has_dev_script: config.hasDevScript,
      });
    },
    []
  );

  // Track configuration deleted
  const trackConfigurationDeleted = useCallback(
    (previewConfigId: string) => {
      posthog.capture("preview_configuration_deleted", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        preview_config_id: previewConfigId,
      });
    },
    []
  );

  // Track repo search
  const trackRepoSearched = useCallback(
    (searchQuery: string, resultCount: number) => {
      posthog.capture("preview_repo_searched", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        search_query: searchQuery,
        result_count: resultCount,
      });
    },
    []
  );

  // Track repo selected for configuration
  const trackRepoSelected = useCallback(
    (repoFullName: string, isPrivate: boolean) => {
      posthog.capture("preview_repo_selected", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: repoFullName,
        is_private: isPrivate,
      });
    },
    []
  );

  // Track GitHub account added
  const trackGitHubAccountAdded = useCallback(
    (installationId: number, accountLogin: string | null) => {
      posthog.capture("preview_github_account_added", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        installation_id: installationId,
        account_login: accountLogin,
      });
    },
    []
  );

  // Track test job actions
  const trackTestJobCreated = useCallback(
    (prUrl: string, prNumber: number) => {
      posthog.capture("preview_test_job_created", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        pr_url: prUrl,
        pr_number: prNumber,
      });
    },
    []
  );

  const trackTestJobRetried = useCallback(
    (previewRunId: string, prNumber: number) => {
      posthog.capture("preview_test_job_retried", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        preview_run_id: previewRunId,
        pr_number: prNumber,
      });
    },
    []
  );

  // Track commands copied
  const trackCommandsCopied = useCallback(() => {
    posthog.capture("preview_commands_copied", {
      team_slug_or_id: contextRef.current.teamSlugOrId,
      repo_full_name: contextRef.current.repoFullName,
    });
  }, []);

  // Track env paste used
  const trackEnvPasteUsed = useCallback((parsedVarCount: number) => {
    posthog.capture("preview_env_paste_used", {
      team_slug_or_id: contextRef.current.teamSlugOrId,
      repo_full_name: contextRef.current.repoFullName,
      parsed_var_count: parsedVarCount,
    });
  }, []);

  // Track layout phase transition
  const trackLayoutPhaseChanged = useCallback(
    (phase: "initial-setup" | "transitioning" | "workspace-config") => {
      posthog.capture("preview_layout_phase_changed", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        phase,
      });
    },
    []
  );

  // Track errors
  const trackError = useCallback(
    (errorType: string, errorMessage: string, context?: string) => {
      posthog.capture("preview_error", {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        repo_full_name: contextRef.current.repoFullName,
        error_type: errorType,
        error_message: errorMessage,
        context,
      });
    },
    []
  );

  // Track waitlist signup
  const trackWaitlistInteraction = useCallback(
    (provider: "gitlab" | "bitbucket", action: "viewed" | "signed_up") => {
      posthog.capture(`preview_waitlist_${action}`, {
        team_slug_or_id: contextRef.current.teamSlugOrId,
        provider,
      });
    },
    []
  );

  return {
    trackPageView,
    trackFrameworkSelected,
    trackMachinePresetSelected,
    trackEnvVarsConfigured,
    trackScriptsConfigured,
    trackSetupStepEntered,
    trackSetupStepCompleted,
    trackWorkspaceStarted,
    trackWorkspaceReady,
    trackConfigurationSaved,
    trackConfigurationDeleted,
    trackRepoSearched,
    trackRepoSelected,
    trackGitHubAccountAdded,
    trackTestJobCreated,
    trackTestJobRetried,
    trackCommandsCopied,
    trackEnvPasteUsed,
    trackLayoutPhaseChanged,
    trackError,
    trackWaitlistInteraction,
  };
}
