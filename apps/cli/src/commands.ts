import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getApiIntegrationsGithubRepos,
  postApiEnvironments,
  postApiMorphSetupInstance,
  type CreateEnvironmentResponse,
  type GithubReposResponse,
  type ListEnvironmentsResponse,
  type SetupInstanceResponse,
} from "@cmux/www-openapi-client";
import { createClient } from "@cmux/www-openapi-client/client";
import { cliConfig } from "./config";
import type { StackUser } from "./auth";
import {
  authenticateUser,
  type AuthenticatedSession,
  type AuthenticationCallbacks,
  clearStoredRefreshToken,
} from "./auth";
import {
  describeTeam,
  fetchEnvironmentsForTeam,
  fetchProviderConnections,
  formatStackCookie,
  mintGithubInstallState,
  type ProviderConnection,
  type TeamMembership,
} from "./cmuxClient";

interface CommandOptions {
  quiet?: boolean;
}

const statusLogger = (
  quiet: boolean | undefined,
): AuthenticationCallbacks["onStatus"] => {
  if (quiet) {
    return undefined;
  }
  return (status: string) => {
    process.stderr.write(`- ${status}\n`);
  };
};

const browserLogger = (
  quiet: boolean | undefined,
): AuthenticationCallbacks["onBrowserUrl"] => {
  if (quiet) {
    return undefined;
  }
  return (url: string) => {
    process.stderr.write(`Open the following URL to continue: ${url}\n`);
  };
};

const findTeam = (
  memberships: TeamMembership[],
  slugOrId: string,
): TeamMembership | undefined => {
  const normalized = slugOrId.trim().toLowerCase();
  return memberships.find((membership) => {
    const slug = membership.team.slug?.toLowerCase();
    if (slug && slug === normalized) {
      return true;
    }
    return membership.team.teamId.toLowerCase() === normalized;
  });
};

const authenticate = async (
  options: CommandOptions = {},
): Promise<AuthenticatedSession> => {
  return authenticateUser(cliConfig, {
    onBrowserUrl: browserLogger(options.quiet),
    onStatus: statusLogger(options.quiet),
  });
};

const userDisplayName = (user: StackUser): string => {
  if (user.display_name && user.display_name.trim().length > 0) {
    return user.display_name;
  }
  const email =
    user.primary_email ??
    user.emails?.find((entry) => entry.primary)?.email ??
    user.emails?.[0]?.email;
  return email ?? user.id;
};

const userPrimaryEmail = (user: StackUser): string | undefined => {
  if (user.primary_email && user.primary_email.trim().length > 0) {
    return user.primary_email.trim();
  }
  const fromPrimary = user.emails?.find(
    (entry) => entry.primary && entry.email.trim().length > 0,
  );
  if (fromPrimary) {
    return fromPrimary.email.trim();
  }
  const firstEmail = user.emails?.find(
    (entry) => entry.email.trim().length > 0,
  );
  return firstEmail?.email.trim();
};

interface GitRepositoryInfo {
  root: string;
  owner: string;
  name: string;
  remoteUrl: string;
}

const runGitCommand = (args: string[]): { stdout: string; stderr: string } => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(
      `Failed to run git ${args.join(" ")}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    throw new Error(
      output.length > 0
        ? output
        : `git ${args.join(" ")} exited with code ${result.status}`,
    );
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr?.trim() ?? "",
  };
};

const parseGithubRemote = (
  remoteUrl: string,
): { owner: string; name: string } | null => {
  const normalized = remoteUrl.trim();
  const sshMatch = normalized.match(
    /^git@github\.com:(?<owner>[^/]+)\/(?<name>.+?)(?:\.git)?$/i,
  );
  const sshOwner = sshMatch?.groups?.owner;
  const sshName = sshMatch?.groups?.name;
  if (sshOwner && sshName) {
    return {
      owner: sshOwner,
      name: sshName.replace(/\.git$/i, ""),
    };
  }

  const scpMatch = normalized.match(
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<name>.+?)(?:\.git)?$/i,
  );
  const scpOwner = scpMatch?.groups?.owner;
  const scpName = scpMatch?.groups?.name;
  if (scpOwner && scpName) {
    return {
      owner: scpOwner,
      name: scpName.replace(/\.git$/i, ""),
    };
  }

  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const parts = url.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/i, "")
      .split("/")
      .filter((segment) => segment.length > 0);
    if (parts.length >= 2) {
      const owner = parts[0];
      const name = parts[1];
      if (owner && name) {
        return {
          owner,
          name,
        };
      }
    }
  } catch (_error) {
    // Not a standard URL; fall through
  }

  return null;
};

const detectGitRepository = (): GitRepositoryInfo => {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (inside.error) {
    throw new Error(
      `Failed to determine git repository status: ${inside.error.message}`,
    );
  }
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    throw new Error(
      "This command must be run inside a Git repository with a GitHub remote.",
    );
  }

  const { stdout: root } = runGitCommand(["rev-parse", "--show-toplevel"]);

  let remoteUrl: string | null = null;
  try {
    const { stdout } = runGitCommand(["remote", "get-url", "origin"]);
    remoteUrl = stdout;
  } catch (_error) {
    const remotes = spawnSync("git", ["remote", "-v"], { encoding: "utf8" });
    if (remotes.status === 0) {
      const firstLine = remotes.stdout.split("\n").find((line) => line.trim());
      if (firstLine) {
        const tokens = firstLine.trim().split(/\s+/);
        if (tokens.length >= 2) {
          const remoteCandidate = tokens[1];
          if (remoteCandidate) {
            remoteUrl = remoteCandidate;
          }
        }
      }
    }
  }

  if (!remoteUrl) {
    throw new Error(
      "No Git remote found. Configure an origin remote pointing to GitHub and retry.",
    );
  }

  const parsed = parseGithubRemote(remoteUrl);
  if (!parsed) {
    throw new Error(
      `Unsupported Git remote "${remoteUrl}". Expected a GitHub repository.`,
    );
  }

  return {
    root,
    owner: parsed.owner,
    name: parsed.name,
    remoteUrl,
  };
};

const readEnvFileContent = async (filePath?: string): Promise<string> => {
  if (!filePath) {
    return "";
  }
  const absolutePath = resolve(process.cwd(), filePath);
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error reading file";
    throw new Error(
      `Failed to read environment file at "${filePath}": ${message}`,
    );
  }
};

const configureConnectionUrl = (
  connection: ProviderConnection,
): string | null => {
  if (!connection.accountLogin) {
    return null;
  }
  if (connection.accountType === "Organization") {
    return `https://github.com/organizations/${connection.accountLogin}/settings/installations/${connection.installationId}`;
  }
  return `https://github.com/settings/installations/${connection.installationId}`;
};

const buildInstallUrl = async (
  teamSlugOrId: string,
  accessToken: string,
): Promise<string | null> => {
  const slug = cliConfig.githubAppSlug;
  if (!slug) {
    return null;
  }
  const baseUrl = `https://github.com/apps/${slug}/installations/new`;
  try {
    const state = await mintGithubInstallState(
      cliConfig,
      accessToken,
      teamSlugOrId,
    );
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}state=${encodeURIComponent(state)}`;
  } catch (_error) {
    return baseUrl;
  }
};

const getTeamIdentifier = (team: TeamMembership): string => {
  return team.team.slug ?? team.team.teamId;
};

const logStatus = (quiet: boolean | undefined, message: string) => {
  if (quiet) {
    return;
  }
  process.stderr.write(`- ${message}\n`);
};

export const login = async (options: CommandOptions = {}) => {
  const session = await authenticate(options);
  const userName = userDisplayName(session.context.user);
  process.stdout.write(`Logged in as ${userName}.\n`);
};

export const logout = async () => {
  await clearStoredRefreshToken(cliConfig.stack.projectId);
  process.stdout.write("Cleared stored credentials.\n");
};

export const listTeams = async (options: CommandOptions = {}) => {
  const session = await authenticate(options);
  if (session.memberships.length === 0) {
    process.stdout.write("No team memberships found.\n");
    return;
  }
  session.memberships.forEach((membership) => {
    process.stdout.write(`${describeTeam(membership)}\n`);
  });
};

interface ListEnvironmentsOptions extends CommandOptions {
  team: string;
  json?: boolean;
}

const formatEnvironmentsText = (
  environments: ListEnvironmentsResponse,
): string => {
  if (environments.length === 0) {
    return "No environments found.";
  }
  const lines = environments.map((env) => {
    const parts = [`${env.name} (${env.id})`];
    if (env.description) {
      parts.push(`description: ${env.description}`);
    }
    parts.push(`snapshot: ${env.morphSnapshotId ?? "n/a"}`);
    return parts.join(" | ");
  });
  return lines.join("\n");
};

export const listEnvironments = async (
  options: ListEnvironmentsOptions,
) => {
  const session = await authenticate(options);
  const team = findTeam(session.memberships, options.team);
  if (!team) {
    throw new Error(
      `Team "${options.team}" not found. Use \`cmux-cli teams\` to list available teams.`,
    );
  }

  const environments = await fetchEnvironmentsForTeam(
    cliConfig,
    session.context,
    team.team.slug ?? team.team.teamId,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(environments, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatEnvironmentsText(environments)}\n`);
};

interface ShowAuthOptions extends CommandOptions {
  json?: boolean;
}

export const showAuth = async (options: ShowAuthOptions = {}) => {
  const session = await authenticate(options);
  const user = session.context.user;
  const userName = userDisplayName(user);
  const primaryEmail = userPrimaryEmail(user);

  if (options.json) {
    const payload = {
      user: {
        id: user.id,
        displayName: user.display_name ?? null,
        primaryEmail: primaryEmail ?? null,
        emails: user.emails ?? [],
      },
      teams: session.memberships.map((membership) => ({
        id: membership.team.teamId,
        slug: membership.team.slug ?? null,
        displayName: membership.team.displayName ?? null,
        name: membership.team.name ?? null,
        role: membership.role ?? null,
      })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`User: ${userName}\n`);
  process.stdout.write(`User ID: ${user.id}\n`);
  if (primaryEmail) {
    process.stdout.write(`Email: ${primaryEmail}\n`);
  }

  if (session.memberships.length === 0) {
    process.stdout.write("Teams: none\n");
    return;
  }

  process.stdout.write("Teams:\n");
  session.memberships.forEach((membership) => {
    process.stdout.write(`- ${describeTeam(membership)}\n`);
  });
};

interface CreateEnvironmentOptions extends CommandOptions {
  team: string;
  name?: string;
  envFile?: string;
}

export const createEnvironment = async (
  options: CreateEnvironmentOptions,
) => {
  const session = await authenticate(options);
  const team = findTeam(session.memberships, options.team);
  if (!team) {
    throw new Error(
      `Team "${options.team}" not found. Use \`cmux-cli teams\` to list available teams.`,
    );
  }
  const teamSlugOrId = getTeamIdentifier(team);

  const gitRepo = detectGitRepository();
  const repoFullName = `${gitRepo.owner}/${gitRepo.name}`;
  logStatus(options.quiet, `Detected repository ${repoFullName}`);

  const environmentName =
    options.name && options.name.trim().length > 0
      ? options.name.trim()
      : gitRepo.name;
  if (environmentName.length === 0) {
    throw new Error("Environment name cannot be empty.");
  }

  const envVarsContent = await readEnvFileContent(options.envFile);

  logStatus(options.quiet, "Checking GitHub App installation…");
  const providerConnections = await fetchProviderConnections(
    cliConfig,
    session.context.accessToken,
    teamSlugOrId,
  );
  const matchingConnection = providerConnections.find(
    (connection) =>
      connection.isActive &&
      connection.accountLogin?.toLowerCase() ===
        gitRepo.owner.toLowerCase(),
  );

  if (!matchingConnection) {
    const installUrl = await buildInstallUrl(
      teamSlugOrId,
      session.context.accessToken,
    );
    const slug = cliConfig.githubAppSlug;
    const baseMessage = `No active cmux GitHub App installation found for "${gitRepo.owner}".`;
    if (installUrl) {
      throw new Error(
        `${baseMessage} Install or update the app for this organization by visiting:\n${installUrl}`,
      );
    }
    if (slug) {
      throw new Error(
        `${baseMessage} Install the app at https://github.com/apps/${slug}/installations/new.`,
      );
    }
    throw new Error(
      `${baseMessage} Install the cmux GitHub App and grant it access to ${repoFullName}.`,
    );
  }

  logStatus(options.quiet, "Confirming repository access…");
  const cookieHeader = formatStackCookie(
    cliConfig.stack.projectId,
    session.context.refreshToken,
    session.context.accessToken,
  );
  const openApiClient = createClient({
    baseUrl: cliConfig.wwwOrigin,
  });
  const repoResponseResult = await getApiIntegrationsGithubRepos({
    client: openApiClient,
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
    },
    query: {
      team: teamSlugOrId,
      installationId: matchingConnection.installationId,
      search: gitRepo.name,
    },
    responseStyle: "data",
    throwOnError: true,
  });
  const repoResponse: GithubReposResponse | undefined =
    repoResponseResult.data;
  if (!repoResponse) {
    throw new Error("Failed to verify GitHub repository access.");
  }

  const repoAccessible = repoResponse.repos.some(
    (repo) => repo.full_name.toLowerCase() === repoFullName.toLowerCase(),
  );
  if (!repoAccessible) {
    const configureUrl = configureConnectionUrl(matchingConnection);
    const ownerLabel =
      matchingConnection.accountLogin ?? gitRepo.owner;
    let message = `The cmux GitHub App installation for "${ownerLabel}" does not have access to ${repoFullName}.`;
    if (configureUrl) {
      message += ` Add the repository by visiting:\n${configureUrl}`;
    } else {
      message += " Update the installation to include this repository.";
    }
    throw new Error(message);
  }

  logStatus(options.quiet, "Provisioning Morph workspace…");
  const setupResponseResult = await postApiMorphSetupInstance({
    client: openApiClient,
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: {
      teamSlugOrId,
      selectedRepos: [repoFullName],
    },
    responseStyle: "data",
    throwOnError: true,
  });
  const setupResponse: SetupInstanceResponse | undefined =
    setupResponseResult.data;
  if (!setupResponse) {
    throw new Error("Failed to provision Morph workspace.");
  }

  logStatus(options.quiet, "Creating environment snapshot…");
  const createResponseResult = await postApiEnvironments({
    client: openApiClient,
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: {
      teamSlugOrId,
      name: environmentName,
      morphInstanceId: setupResponse.instanceId,
      envVarsContent,
      selectedRepos: [repoFullName],
    },
    responseStyle: "data",
    throwOnError: true,
  });
  const createResponse: CreateEnvironmentResponse | undefined =
    createResponseResult.data;
  if (!createResponse) {
    throw new Error("Failed to create environment snapshot.");
  }

  const summary = [
    `Environment "${environmentName}" created (ID: ${createResponse.id}).`,
    `Snapshot ID: ${createResponse.snapshotId}`,
    `Repository: ${repoFullName}`,
    `VSCode URL: ${setupResponse.vscodeUrl}`,
  ];
  process.stdout.write(`${summary.join("\n")}\n`);
};
