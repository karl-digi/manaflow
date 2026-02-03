import { getAccessToken, CONVEX_SITE_URL } from "./auth.js";

// API base URL from auth config
const API_BASE_URL = CONVEX_SITE_URL;

// =============================================================================
// API Types
// =============================================================================

export interface DevboxInstance {
  id: string;
  provider: "e2b";
  status: string;
  name?: string;
  templateId?: string;
  vscodeUrl?: string;
  workerUrl?: string;
  vncUrl?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ListInstancesResponse {
  instances: DevboxInstance[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface UserProfile {
  userId: string;
  email?: string;
  name?: string;
  teamId?: string;
  teamSlug?: string;
  teamDisplayName?: string;
}

export interface ApiError {
  code: number;
  message: string;
}

// =============================================================================
// API Client
// =============================================================================

async function apiRequest<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated. Run 'devbox login' first.");
  }

  let url = `${API_BASE_URL}${path}`;
  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json()) as T | ApiError;

  if (!response.ok) {
    const error = data as ApiError;
    throw new Error(error.message || `API error: ${response.status}`);
  }

  return data as T;
}

// =============================================================================
// API Functions
// =============================================================================

export async function getMe(): Promise<UserProfile> {
  return apiRequest<UserProfile>("GET", "/api/v2/devbox/me");
}

export async function createInstance(options: {
  teamSlugOrId: string;
  name?: string;
  templateId?: string;
  ttlSeconds?: number;
  metadata?: Record<string, string>;
  envs?: Record<string, string>;
}): Promise<DevboxInstance> {
  return apiRequest<DevboxInstance>("POST", "/api/v2/devbox/instances", {
    body: options,
  });
}

export async function listInstances(teamSlugOrId: string): Promise<DevboxInstance[]> {
  const response = await apiRequest<ListInstancesResponse>("GET", "/api/v2/devbox/instances", {
    params: { teamSlugOrId },
  });
  return response.instances;
}

export async function getInstance(id: string, teamSlugOrId: string): Promise<DevboxInstance> {
  return apiRequest<DevboxInstance>("GET", `/api/v2/devbox/instances/${id}`, {
    params: { teamSlugOrId },
  });
}

export async function execCommand(
  id: string,
  teamSlugOrId: string,
  command: string
): Promise<ExecResult> {
  return apiRequest<ExecResult>("POST", `/api/v2/devbox/instances/${id}/exec`, {
    body: { teamSlugOrId, command },
  });
}

export async function pauseInstance(id: string, teamSlugOrId: string): Promise<void> {
  await apiRequest<{ paused: boolean }>("POST", `/api/v2/devbox/instances/${id}/pause`, {
    body: { teamSlugOrId },
  });
}

export async function resumeInstance(id: string, teamSlugOrId: string): Promise<void> {
  await apiRequest<{ resumed: boolean }>("POST", `/api/v2/devbox/instances/${id}/resume`, {
    body: { teamSlugOrId },
  });
}

export async function stopInstance(id: string, teamSlugOrId: string): Promise<void> {
  await apiRequest<{ stopped: boolean }>("POST", `/api/v2/devbox/instances/${id}/stop`, {
    body: { teamSlugOrId },
  });
}

export async function updateTtl(
  id: string,
  teamSlugOrId: string,
  ttlSeconds: number
): Promise<void> {
  await apiRequest<{ updated: boolean }>("POST", `/api/v2/devbox/instances/${id}/ttl`, {
    body: { teamSlugOrId, ttlSeconds },
  });
}

// =============================================================================
// Worker API Types
// =============================================================================

export interface WorkerStatus {
  provider: string;
  processes: number;
  memory: string;
  disk: string;
  cdpAvailable: boolean;
  vncAvailable: boolean;
}

export interface WorkerServices {
  vscode: { running: boolean; port: number };
  chrome: { running: boolean; port: number };
  vnc: { running: boolean; port: number };
  novnc: { running: boolean; port: number };
  worker: { running: boolean; port: number };
}

export interface CdpInfo {
  wsUrl: string;
  httpEndpoint: string;
}

export interface BrowserAgentResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  error?: string;
}

export interface ScreenshotResult {
  success: boolean;
  path?: string;
  base64?: string;
  error?: string;
}

// =============================================================================
// Worker API Client
// =============================================================================

// Cache for worker auth tokens: instanceId -> token
const workerTokenCache = new Map<string, string>();

/**
 * Get auth token for a worker instance
 * First tries cache, then fetches via E2B command execution
 */
export async function getWorkerAuthToken(
  id: string,
  teamSlugOrId: string
): Promise<string> {
  // Check cache
  const cached = workerTokenCache.get(id);
  if (cached) {
    return cached;
  }

  // Fetch token by reading file from sandbox
  const result = await execCommand(id, teamSlugOrId, "cat /home/user/.worker-auth-token");
  if (result.exit_code !== 0 || !result.stdout) {
    throw new Error("Failed to get worker auth token");
  }

  const token = result.stdout.trim();
  workerTokenCache.set(id, token);
  return token;
}

/**
 * Make request to worker API
 */
async function workerRequest<T>(
  workerUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token: string;
  }
): Promise<T> {
  const url = `${workerUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json()) as T;

  if (!response.ok) {
    const error = data as { error?: string };
    throw new Error(error.error || `Worker API error: ${response.status}`);
  }

  return data;
}

/**
 * Get worker status
 */
export async function getWorkerStatus(
  workerUrl: string,
  token: string
): Promise<WorkerStatus> {
  return workerRequest<WorkerStatus>(workerUrl, "/status", { token });
}

/**
 * Get worker services
 */
export async function getWorkerServices(
  workerUrl: string,
  token: string
): Promise<WorkerServices> {
  return workerRequest<WorkerServices>(workerUrl, "/services", { token });
}

/**
 * Get CDP info
 */
export async function getCdpInfo(
  workerUrl: string,
  token: string
): Promise<CdpInfo> {
  return workerRequest<CdpInfo>(workerUrl, "/cdp-info", { token });
}

/**
 * Run browser agent
 */
export async function runBrowserAgent(
  workerUrl: string,
  token: string,
  prompt: string,
  options?: { timeout?: number; screenshotPath?: string }
): Promise<BrowserAgentResult> {
  return workerRequest<BrowserAgentResult>(workerUrl, "/browser-agent", {
    method: "POST",
    token,
    body: { prompt, ...options },
  });
}

/**
 * Take screenshot
 */
export async function takeScreenshot(
  workerUrl: string,
  token: string,
  path?: string
): Promise<ScreenshotResult> {
  return workerRequest<ScreenshotResult>(workerUrl, "/screenshot", {
    method: "POST",
    token,
    body: { path },
  });
}

/**
 * Execute command directly via worker (with env vars)
 */
export async function workerExec(
  workerUrl: string,
  token: string,
  command: string,
  options?: { timeout?: number; env?: Record<string, string> }
): Promise<ExecResult> {
  return workerRequest<ExecResult>(workerUrl, "/exec", {
    method: "POST",
    token,
    body: { command, ...options },
  });
}

/**
 * Read file via worker
 */
export async function workerReadFile(
  workerUrl: string,
  token: string,
  path: string
): Promise<string> {
  const result = await workerRequest<{ content: string }>(workerUrl, "/read-file", {
    method: "POST",
    token,
    body: { path },
  });
  return result.content;
}

/**
 * Write file via worker
 */
export async function workerWriteFile(
  workerUrl: string,
  token: string,
  path: string,
  content: string
): Promise<void> {
  await workerRequest<{ success: boolean }>(workerUrl, "/write-file", {
    method: "POST",
    token,
    body: { path, content },
  });
}
