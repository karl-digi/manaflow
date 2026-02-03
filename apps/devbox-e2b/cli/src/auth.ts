import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Stack Auth configuration - must match cmux/dba CLIs for credential sharing
const STACK_AUTH_API_URL = "https://api.stack-auth.com";

// Dev Stack Auth project
const DEV_STACK_PROJECT_ID = "1467bed0-8522-45ee-a8d8-055de324118c";
const DEV_PUBLISHABLE_KEY = "pck_pt4nwry6sdskews2pxk4g2fbe861ak2zvaf3mqendspa0";
const DEV_CMUX_URL = "http://localhost:9779";
const DEV_CONVEX_SITE_URL = "https://famous-camel-162.convex.site";

// Prod Stack Auth project (same as dev - shared Stack Auth project for credential sharing with cmux-devbox)
const PROD_STACK_PROJECT_ID = "1467bed0-8522-45ee-a8d8-055de324118c";
const PROD_PUBLISHABLE_KEY = "pck_pt4nwry6sdskews2pxk4g2fbe861ak2zvaf3mqendspa0";
const PROD_CMUX_URL = "https://cmux.sh";
// NOTE: Uses famous-camel-162 because the v2 devbox API is deployed there, not adorable-wombat
const PROD_CONVEX_SITE_URL = "https://famous-camel-162.convex.site";

// Determine if we're in dev mode
export const IS_DEV = process.env.DEVBOX_CLI_DEV === "1" || process.env.NODE_ENV === "development";

// Get configuration based on environment
export const STACK_PROJECT_ID = process.env.STACK_PROJECT_ID ?? (IS_DEV ? DEV_STACK_PROJECT_ID : PROD_STACK_PROJECT_ID);
export const STACK_PUBLISHABLE_KEY = process.env.STACK_PUBLISHABLE_CLIENT_KEY ?? (IS_DEV ? DEV_PUBLISHABLE_KEY : PROD_PUBLISHABLE_KEY);
export const CMUX_URL = process.env.CMUX_API_URL ?? (IS_DEV ? DEV_CMUX_URL : PROD_CMUX_URL);
export const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL ?? (IS_DEV ? DEV_CONVEX_SITE_URL : PROD_CONVEX_SITE_URL);

const KEYCHAIN_SERVICE = "cmux";

interface CachedToken {
  token: string;
  expires_at: number;
}

function getConfigDir(): string {
  return join(homedir(), ".config", "cmux");
}

function getRefreshTokenAccount(): string {
  return `STACK_REFRESH_TOKEN_${STACK_PROJECT_ID}`;
}

function getAccessTokenCacheFile(): string {
  const filename = IS_DEV ? "access_token_cache_dev.json" : "access_token_cache_prod.json";
  return join(getConfigDir(), filename);
}

function getConfigFile(): string {
  const filename = IS_DEV ? "config_dev.json" : "config.json";
  return join(getConfigDir(), filename);
}

// =============================================================================
// Keychain storage (macOS)
// =============================================================================

function storeInKeychain(account: string, value: string): void {
  if (process.platform !== "darwin") {
    throw new Error("Keychain storage is only supported on macOS");
  }

  // Delete existing entry (ignore errors)
  try {
    execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}"`, {
      stdio: "ignore",
    });
  } catch {
    // Ignore - entry may not exist
  }

  // Add new entry
  execSync(
    `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${value}" -A`,
    { stdio: "ignore" }
  );
}

function getFromKeychain(account: string): string | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const result = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    );
    const token = result.trim();
    return token || null;
  } catch {
    return null;
  }
}

function deleteFromKeychain(account: string): void {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}"`, {
      stdio: "ignore",
    });
  } catch {
    // Ignore - entry may not exist
  }
}

// =============================================================================
// File-based storage (Linux/fallback)
// =============================================================================

function getCredentialsFile(): string {
  return join(getConfigDir(), "credentials.json");
}

function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readCredentials(): Record<string, string> {
  try {
    const content = readFileSync(getCredentialsFile(), "utf-8");
    return JSON.parse(content) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCredentials(creds: Record<string, string>): void {
  ensureConfigDir();
  const file = getCredentialsFile();
  writeFileSync(file, JSON.stringify(creds, null, 2));
  chmodSync(file, 0o600);
}

// =============================================================================
// Refresh token storage
// =============================================================================

export function storeRefreshToken(token: string): void {
  if (process.platform === "darwin") {
    storeInKeychain(getRefreshTokenAccount(), token);
  } else {
    const creds = readCredentials();
    creds.stack_refresh_token = token;
    writeCredentials(creds);
  }
}

export function getRefreshToken(): string | null {
  if (process.platform === "darwin") {
    return getFromKeychain(getRefreshTokenAccount());
  } else {
    const creds = readCredentials();
    return creds.stack_refresh_token ?? null;
  }
}

export function deleteRefreshToken(): void {
  if (process.platform === "darwin") {
    deleteFromKeychain(getRefreshTokenAccount());
  } else {
    const creds = readCredentials();
    delete creds.stack_refresh_token;
    writeCredentials(creds);
  }
}

// =============================================================================
// Access token cache
// =============================================================================

function decodeJwtExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    const data = JSON.parse(payload) as { exp?: number };
    return data.exp ?? null;
  } catch {
    return null;
  }
}

export function getCachedAccessToken(minValiditySecs = 60): string | null {
  try {
    const file = getAccessTokenCacheFile();
    if (!existsSync(file)) return null;

    const content = readFileSync(file, "utf-8");
    const cached = JSON.parse(content) as CachedToken;

    const now = Math.floor(Date.now() / 1000);
    if (cached.expires_at - now > minValiditySecs) {
      return cached.token;
    }

    // Expired, clean up
    rmSync(file, { force: true });
    return null;
  } catch {
    return null;
  }
}

export function cacheAccessToken(token: string): void {
  const expiresAt = decodeJwtExpiry(token);
  if (!expiresAt) return;

  ensureConfigDir();
  const file = getAccessTokenCacheFile();
  writeFileSync(file, JSON.stringify({ token, expires_at: expiresAt }));
  chmodSync(file, 0o600);
}

export function clearAccessTokenCache(): void {
  try {
    const file = getAccessTokenCacheFile();
    if (existsSync(file)) {
      rmSync(file);
    }
  } catch {
    // Ignore
  }
}

// =============================================================================
// Stack Auth CLI device flow
// =============================================================================

interface CliAuthInitResponse {
  polling_code: string;
  login_code: string;
}

interface CliAuthPollResponse {
  status: "pending" | "success" | "expired";
  refresh_token?: string;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
}

/**
 * Initiate CLI auth flow - returns codes for browser auth
 */
export async function initiateCliAuth(): Promise<CliAuthInitResponse> {
  const response = await fetch(`${STACK_AUTH_API_URL}/api/v1/auth/cli`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stack-project-id": STACK_PROJECT_ID,
      "x-stack-publishable-client-key": STACK_PUBLISHABLE_KEY,
      "x-stack-access-type": "client",
    },
    body: JSON.stringify({ expires_in_millis: 600000 }), // 10 minutes
  });

  if (!response.ok) {
    throw new Error(`Failed to initiate auth: ${response.status}`);
  }

  return response.json() as Promise<CliAuthInitResponse>;
}

/**
 * Poll for auth completion
 */
export async function pollCliAuth(pollingCode: string): Promise<CliAuthPollResponse> {
  const response = await fetch(`${STACK_AUTH_API_URL}/api/v1/auth/cli/poll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stack-project-id": STACK_PROJECT_ID,
      "x-stack-publishable-client-key": STACK_PUBLISHABLE_KEY,
      "x-stack-access-type": "client",
    },
    body: JSON.stringify({ polling_code: pollingCode }),
  });

  if (!response.ok && response.status !== 200 && response.status !== 201) {
    return { status: "pending" };
  }

  return response.json() as Promise<CliAuthPollResponse>;
}

/**
 * Get the browser URL for auth confirmation
 */
export function getAuthConfirmUrl(loginCode: string): string {
  return `${CMUX_URL}/handler/cli-auth-confirm?login_code=${loginCode}`;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await fetch(`${STACK_AUTH_API_URL}/api/v1/auth/sessions/current/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-stack-access-type": "client",
        "x-stack-project-id": STACK_PROJECT_ID,
        "x-stack-publishable-client-key": STACK_PUBLISHABLE_KEY,
        "x-stack-refresh-token": refreshToken,
      },
      body: JSON.stringify({}), // Stack Auth requires a JSON body
    });

    if (!response.ok) {
      console.error(`Failed to refresh token: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as RefreshResponse;

    // Store the new refresh token if provided
    if (data.refresh_token) {
      storeRefreshToken(data.refresh_token);
    }

    // Cache the new access token
    if (data.access_token) {
      cacheAccessToken(data.access_token);
      return data.access_token;
    }

    return null;
  } catch (err) {
    console.error("Failed to refresh token:", err);
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  // Check cache first
  const cached = getCachedAccessToken();
  if (cached) {
    return cached;
  }

  // Refresh if we have a refresh token
  return refreshAccessToken();
}

export function isLoggedIn(): boolean {
  return getRefreshToken() !== null;
}

// =============================================================================
// Config storage
// =============================================================================

function readConfig(): Record<string, unknown> {
  try {
    const content = readFileSync(getConfigFile(), "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, unknown>): void {
  ensureConfigDir();
  const file = getConfigFile();
  writeFileSync(file, JSON.stringify(config, null, 2));
  chmodSync(file, 0o600);
}

export function getDefaultTeam(): string | null {
  const config = readConfig();
  return (config.default_team as string) ?? null;
}

export function setDefaultTeam(teamId: string): void {
  const config = readConfig();
  config.default_team = teamId;
  writeConfig(config);
}

export function clearDefaultTeam(): void {
  const config = readConfig();
  delete config.default_team;
  writeConfig(config);
}
