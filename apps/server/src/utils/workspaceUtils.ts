import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { getConvex } from "./convexClient";

export interface WorkspaceSetupOptions {
  teamSlugOrId: string;
  environmentId: Id<"environments">;
  userId?: string;
}

export interface WorkspaceResult {
  taskId: Id<"tasks">;
  worktreePath?: string;
  terminalId?: string;
  vscodeUrl?: string;
}

/**
 * Creates an untitled workspace task with the given environment
 * This utility function handles the creation of workspace tasks without specific AI work
 */
export async function createUntitledWorkspace(
  options: WorkspaceSetupOptions,
): Promise<WorkspaceResult> {
  const { teamSlugOrId, environmentId } = options;

  // Create the untitled workspace task
  const taskId = await getConvex().mutation(api.tasks.createUntitledWorkspace, {
    teamSlugOrId,
    environmentId,
  });

  return {
    taskId,
  };
}

/**
 * Validates that an environment is properly configured for workspace setup
 */
export async function validateEnvironmentForWorkspace(
  teamSlugOrId: string,
  environmentId: Id<"environments">,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const environment = await getConvex().query(api.environments.get, {
      teamSlugOrId,
      id: environmentId,
    });

    if (!environment) {
      return { valid: false, error: "Environment not found" };
    }

    // Check if environment has at least one repository configured
    if (!environment.selectedRepos || environment.selectedRepos.length === 0) {
      return { 
        valid: false, 
        error: "Environment must have at least one repository configured" 
      };
    }

    // For workspace environments, we don't require a base branch
    // The workspace will use the default branch or let the user choose

    return { valid: true };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Generates a default workspace name based on the environment configuration
 */
export function generateWorkspaceName(environment: {
  name?: string;
  selectedRepos?: string[];
  baseBranch?: string;
}): string {
  if (environment.name) {
    return `Workspace: ${environment.name}`;
  }

  const repoCount = environment.selectedRepos?.length || 0;
  const branch = environment.baseBranch || "main";
  
  if (repoCount === 1) {
    const repoName = environment.selectedRepos?.[0]?.split("/")?.[1] || "repo";
    return `Workspace: ${repoName} (${branch})`;
  }

  return `Workspace: ${repoCount} repos (${branch})`;
}

/**
 * Prepares workspace configuration for agent spawning
 */
export function prepareWorkspaceConfig(
  environment: {
    selectedRepos?: string[];
    baseBranch?: string;
    devScript?: string;
    maintenanceScript?: string;
    exposedPorts?: number[];
    environmentVariables?: Record<string, string>;
  },
) {
  const primaryRepo = environment.selectedRepos?.[0];
  
  return {
    repoUrl: primaryRepo ? `https://github.com/${primaryRepo}.git` : undefined,
    branch: environment.baseBranch || "main",
    taskDescription: "Set up workspace environment - run development scripts and prepare the workspace for use",
    isCloudMode: false, // Default to local mode for workspace
    theme: "dark" as const,
    selectedAgents: ["claude/sonnet-4.5"], // Use an existing agent for workspace setup
    devScript: environment.devScript,
    maintenanceScript: environment.maintenanceScript,
    exposedPorts: environment.exposedPorts || [],
    environmentVariables: environment.environmentVariables || {},
  };
}