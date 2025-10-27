import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/utils/www-env";
import { OpenCmuxClient } from "./OpenCmuxClient";

export const dynamic = "force-dynamic";

type AfterSignInPageProps = {
  searchParams?: {
    after_auth_return_to?: string | string[];
  };
};

const ALLOWED_RETURN_HOST_SUFFIXES = [
  ".cmux.dev",
  ".cmux.sh",
  ".cmux.local",
  ".cmux.localhost",
  ".cmux.app",
] as const;

const ALLOWED_RETURN_HOSTS = new Set<string>([
  "cmux.dev",
  "www.cmux.dev",
  "cmux.sh",
  "www.cmux.sh",
  "cmux.app",
  "www.cmux.app",
  "0github.com",
]);

const DEV_ONLY_RETURN_HOSTS = new Set<string>(["localhost", "127.0.0.1", "::1"]);

export default async function AfterSignInPage({ searchParams }: AfterSignInPageProps = {}) {
  const rawReturnParam = getFirstParam(searchParams?.after_auth_return_to);
  const normalizedReturnTo = normalizeReturnTo(rawReturnParam);

  if (normalizedReturnTo) {
    redirect(normalizedReturnTo);
  }

  const stackCookies = await cookies();
  const stackRefreshToken = stackCookies.get(`stack-refresh-${env.NEXT_PUBLIC_STACK_PROJECT_ID}`)?.value;
  const stackAccessToken = stackCookies.get(`stack-access`)?.value;

  if (stackRefreshToken && stackAccessToken) {
    const target = `cmux://auth-callback?stack_refresh=${encodeURIComponent(stackRefreshToken)}&stack_access=${encodeURIComponent(stackAccessToken)}`;
    return <OpenCmuxClient href={target} />;
  }

  return null;
}

function getFirstParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeReturnTo(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("/")) {
    return value;
  }

  if (value.startsWith("?")) {
    return `/${value}`;
  }

  try {
    const url = new URL(value);
    if (!isTrustedReturnHost(url.hostname)) {
      return null;
    }
    return `${url.pathname || "/"}${url.search}${url.hash}`;
  } catch {
    if (!value.includes(":") && !value.startsWith("//")) {
      return value.startsWith("#") ? `/${value}` : `/${value}`;
    }
  }

  return null;
}

function isTrustedReturnHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (ALLOWED_RETURN_HOSTS.has(normalized)) {
    return true;
  }

  if (ALLOWED_RETURN_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  if (process.env.NODE_ENV !== "production" && DEV_ONLY_RETURN_HOSTS.has(normalized)) {
    return true;
  }

  return false;
}
