import { ConvexHttpClient } from "convex/browser";
import {
  getApiEnvironments,
  type ListEnvironmentsResponse,
} from "@cmux/www-openapi-client";
import { createClient } from "@cmux/www-openapi-client/client";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import type { CLIConfig } from "./config";
import type { StackUser } from "./auth";

export interface TeamMembership {
  teamId: string;
  userId: string;
  role?: "owner" | "member";
  createdAt: number;
  updatedAt: number;
  team: {
    teamId: string;
    slug?: string | null;
    displayName?: string | null;
    name?: string | null;
  };
}

export interface AuthenticatedContext {
  refreshToken: string;
  accessToken: string;
  user: StackUser;
}

export interface ProviderConnection {
  installationId: number;
  accountLogin: string | null;
  accountType: "User" | "Organization" | null;
  type: string | null;
  isActive: boolean;
}

export async function fetchTeamMemberships(
  config: CLIConfig,
  accessToken: string,
): Promise<TeamMembership[]> {
  const convex = new ConvexHttpClient(config.convexUrl);
  convex.setAuth(accessToken);
  const listTeamMembershipsRef = makeFunctionReference<
    "query",
    Record<string, never>,
    unknown
  >("teams:listTeamMemberships");

  const raw = (await convex.query(
    listTeamMembershipsRef,
    {},
  )) as unknown;

  const parsed = membershipsSchema.parse(raw);

  return parsed.map((membership) => ({
    teamId: membership.teamId,
    userId: membership.userId,
    role: membership.role ?? undefined,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    team: {
      teamId: membership.team?.teamId ?? membership.teamId,
      slug: membership.team?.slug ?? null,
      displayName: membership.team?.displayName ?? null,
      name: membership.team?.name ?? null,
    },
  }));
}

export async function fetchProviderConnections(
  config: CLIConfig,
  accessToken: string,
  teamSlugOrId: string,
): Promise<ProviderConnection[]> {
  const convex = new ConvexHttpClient(config.convexUrl);
  convex.setAuth(accessToken);
  const listProviderConnectionsRef = makeFunctionReference<
    "query",
    { teamSlugOrId: string },
    unknown
  >("github:listProviderConnections");
  const raw = (await convex.query(listProviderConnectionsRef, {
    teamSlugOrId,
  })) as unknown;
  const parsed = providerConnectionsSchema.parse(raw);
  return parsed.map((connection) => {
    const accountLogin =
      connection.accountLogin === undefined ||
      connection.accountLogin === null
        ? null
        : connection.accountLogin;
    const accountType =
      connection.accountType === undefined ||
      connection.accountType === null
        ? null
        : connection.accountType;
    const type =
      connection.type === undefined || connection.type === null
        ? null
        : connection.type;
    return {
      installationId: connection.installationId,
      accountLogin,
      accountType,
      type,
      isActive: connection.isActive ?? true,
    };
  });
}

export async function fetchEnvironmentsForTeam(
  config: CLIConfig,
  context: AuthenticatedContext,
  teamSlugOrId: string,
): Promise<ListEnvironmentsResponse> {
  const cookieHeader = formatStackCookie(
    config.stack.projectId,
    context.refreshToken,
    context.accessToken,
  );

  const openApiClient = createClient({
    baseUrl: config.wwwOrigin,
  });

  const result = await getApiEnvironments({
    query: { teamSlugOrId },
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
    },
    client: openApiClient,
    responseStyle: "data",
    throwOnError: true,
  });

  if (!result || !("data" in result) || !result.data) {
    throw new Error("Failed to load environments (empty response).");
  }

  return result.data;
}

export async function mintGithubInstallState(
  config: CLIConfig,
  accessToken: string,
  teamSlugOrId: string,
): Promise<string> {
  const convex = new ConvexHttpClient(config.convexUrl);
  convex.setAuth(accessToken);
  const mintInstallStateRef = makeFunctionReference<
    "mutation",
    { teamSlugOrId: string },
    unknown
  >("github_app:mintInstallState");
  const raw = (await convex.mutation(mintInstallStateRef, {
    teamSlugOrId,
  })) as unknown;
  const parsed = installStateSchema.parse(raw);
  return parsed.state;
}

export function formatStackCookie(
  projectId: string,
  refreshToken: string,
  accessToken: string,
): string {
  const refreshCookieName = `stack-refresh-${projectId}`;
  const cookieParts = [
    `${refreshCookieName}=${encodeURIComponent(refreshToken)}`,
    `stack-access=${encodeURIComponent(accessToken)}`,
  ];
  return cookieParts.join("; ");
}

export function describeTeam(membership: TeamMembership): string {
  const identifier = membership.team.slug ?? membership.team.teamId;
  const label =
    membership.team.displayName ??
    membership.team.name ??
    membership.team.slug ??
    membership.team.teamId;
  const role = membership.role ? ` (${membership.role})` : "";
  return `${label}${role} – ${identifier}`;
}

const teamSchema = z
  .object({
    teamId: z.string(),
    slug: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

const membershipSchema = z
  .object({
    teamId: z.string(),
    userId: z.string(),
    role: z.union([z.literal("owner"), z.literal("member")]).optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    team: teamSchema.optional(),
  })
  .passthrough();

const membershipsSchema = z.array(membershipSchema);

const providerConnectionSchema = z
  .object({
    installationId: z.number(),
    accountLogin: z.string().nullable().optional(),
    accountType: z
      .union([z.literal("User"), z.literal("Organization")])
      .nullable()
      .optional(),
    type: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

const providerConnectionsSchema = z.array(providerConnectionSchema);

const installStateSchema = z
  .object({
    state: z.string(),
  })
  .passthrough();
