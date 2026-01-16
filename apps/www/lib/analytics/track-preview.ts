import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";

// ============================================================================
// Preview.new Analytics Events
// ============================================================================

/**
 * Common properties included with all preview events
 */
type PreviewCommonProps = {
  teamSlugOrId?: string;
  userId?: string;
};

// ----------------------------------------------------------------------------
// Page View Events
// ----------------------------------------------------------------------------

type PreviewDashboardViewedEvent = PreviewCommonProps & {
  configCount: number;
  hasGitHubConnected: boolean;
};

export async function trackPreviewDashboardViewed(
  event: PreviewDashboardViewedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_dashboard_viewed",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      config_count: event.configCount,
      has_github_connected: event.hasGitHubConnected,
    },
  });
}

type PreviewConfigureViewedEvent = PreviewCommonProps & {
  repoFullName: string;
  hasExistingConfig: boolean;
};

export async function trackPreviewConfigureViewed(
  event: PreviewConfigureViewedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_configure_viewed",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      has_existing_config: event.hasExistingConfig,
    },
  });
}

// ----------------------------------------------------------------------------
// Repository Configuration Events
// ----------------------------------------------------------------------------

type PreviewRepoConfiguredEvent = PreviewCommonProps & {
  repoFullName: string;
  frameworkPreset: string;
  machinePreset: string;
  hasEnvVars: boolean;
  envVarCount: number;
  hasMaintenanceScript: boolean;
  hasDevScript: boolean;
};

export async function trackPreviewRepoConfigured(
  event: PreviewRepoConfiguredEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_repo_configured",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      framework_preset: event.frameworkPreset,
      machine_preset: event.machinePreset,
      has_env_vars: event.hasEnvVars,
      env_var_count: event.envVarCount,
      has_maintenance_script: event.hasMaintenanceScript,
      has_dev_script: event.hasDevScript,
    },
  });
}

type PreviewRepoDeletedEvent = PreviewCommonProps & {
  repoFullName: string;
  previewConfigId: string;
};

export async function trackPreviewRepoDeleted(
  event: PreviewRepoDeletedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_repo_deleted",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      preview_config_id: event.previewConfigId,
    },
  });
}

// ----------------------------------------------------------------------------
// Framework Detection Events
// ----------------------------------------------------------------------------

type PreviewFrameworkDetectedEvent = PreviewCommonProps & {
  repoFullName: string;
  detectedFramework: string;
  detectedPackageManager: string;
};

export async function trackPreviewFrameworkDetected(
  event: PreviewFrameworkDetectedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_framework_detected",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      detected_framework: event.detectedFramework,
      detected_package_manager: event.detectedPackageManager,
    },
  });
}

// ----------------------------------------------------------------------------
// Workspace Provisioning Events
// ----------------------------------------------------------------------------

type PreviewWorkspaceProvisionedEvent = PreviewCommonProps & {
  repoFullName: string;
  snapshotId: string;
  provisionDurationMs?: number;
};

export async function trackPreviewWorkspaceProvisioned(
  event: PreviewWorkspaceProvisionedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_workspace_provisioned",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      snapshot_id: event.snapshotId,
      provision_duration_ms: event.provisionDurationMs,
    },
  });
}

// ----------------------------------------------------------------------------
// Configuration Step Events
// ----------------------------------------------------------------------------

type PreviewSetupStepCompletedEvent = PreviewCommonProps & {
  repoFullName: string;
  step: "scripts" | "env-vars" | "run-scripts" | "browser-setup";
  stepNumber: number;
};

export async function trackPreviewSetupStepCompleted(
  event: PreviewSetupStepCompletedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_setup_step_completed",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      step: event.step,
      step_number: event.stepNumber,
    },
  });
}

// ----------------------------------------------------------------------------
// Test Job Events
// ----------------------------------------------------------------------------

type PreviewTestJobCreatedEvent = PreviewCommonProps & {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
};

export async function trackPreviewTestJobCreated(
  event: PreviewTestJobCreatedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_test_job_created",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      pr_number: event.prNumber,
      pr_url: event.prUrl,
    },
  });
}

type PreviewTestJobDispatchedEvent = PreviewCommonProps & {
  repoFullName: string;
  prNumber: number;
  previewRunId: string;
};

export async function trackPreviewTestJobDispatched(
  event: PreviewTestJobDispatchedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_test_job_dispatched",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      pr_number: event.prNumber,
      preview_run_id: event.previewRunId,
    },
  });
}

type PreviewTestJobCompletedEvent = PreviewCommonProps & {
  repoFullName: string;
  prNumber: number;
  previewRunId: string;
  status: "completed" | "failed" | "skipped";
  durationMs?: number;
  hasUiChanges?: boolean;
};

export async function trackPreviewTestJobCompleted(
  event: PreviewTestJobCompletedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_test_job_completed",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      pr_number: event.prNumber,
      preview_run_id: event.previewRunId,
      status: event.status,
      duration_ms: event.durationMs,
      has_ui_changes: event.hasUiChanges,
    },
  });
}

// ----------------------------------------------------------------------------
// GitHub Integration Events
// ----------------------------------------------------------------------------

type PreviewGitHubConnectedEvent = PreviewCommonProps & {
  installationId: number;
  accountLogin: string | null;
  accountType: string | null;
};

export async function trackPreviewGitHubConnected(
  event: PreviewGitHubConnectedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_github_connected",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      installation_id: event.installationId,
      account_login: event.accountLogin,
      account_type: event.accountType,
    },
  });
}

// ----------------------------------------------------------------------------
// Waitlist Events
// ----------------------------------------------------------------------------

type PreviewWaitlistSignupEvent = PreviewCommonProps & {
  provider: "gitlab" | "bitbucket";
  email: string | null;
};

export async function trackPreviewWaitlistSignup(
  event: PreviewWaitlistSignupEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_waitlist_signup",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      provider: event.provider,
      email: event.email,
    },
  });
}

// ----------------------------------------------------------------------------
// PR Comment Events
// ----------------------------------------------------------------------------

type PreviewCommentPostedEvent = PreviewCommonProps & {
  repoFullName: string;
  prNumber: number;
  previewRunId: string;
  commentType: "initial" | "update";
  hasScreenshot: boolean;
  hasVideo: boolean;
};

export async function trackPreviewCommentPosted(
  event: PreviewCommentPostedEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_comment_posted",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      pr_number: event.prNumber,
      preview_run_id: event.previewRunId,
      comment_type: event.commentType,
      has_screenshot: event.hasScreenshot,
      has_video: event.hasVideo,
    },
  });
}

// ----------------------------------------------------------------------------
// Error Events
// ----------------------------------------------------------------------------

type PreviewErrorEvent = PreviewCommonProps & {
  repoFullName?: string;
  errorType: string;
  errorMessage: string;
  context?: string;
};

export async function trackPreviewError(
  event: PreviewErrorEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "preview_error",
    properties: {
      team_slug_or_id: event.teamSlugOrId,
      repo_full_name: event.repoFullName,
      error_type: event.errorType,
      error_message: event.errorMessage,
      context: event.context,
    },
  });
}
