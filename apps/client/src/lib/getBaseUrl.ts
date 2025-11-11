import { env } from "@/client-env";

/**
 * Get the base URL for the application, with VITE_VERCEL_URL as a fallback.
 * This allows the app to work on Vercel deployments without additional configuration.
 */
export function getBaseUrl(type: "server" | "www"): string {
  // Access VITE_VERCEL_URL directly from import.meta.env since it's not in the env schema
  const viteVercelUrl = import.meta.env.VITE_VERCEL_URL;

  if (type === "server") {
    // For server connections, prefer NEXT_PUBLIC_SERVER_ORIGIN,
    // fall back to VITE_VERCEL_URL, then localhost
    return env.NEXT_PUBLIC_SERVER_ORIGIN || viteVercelUrl || "http://localhost:9776";
  }

  // For www/API connections, NEXT_PUBLIC_WWW_ORIGIN is required
  // but we could potentially use VITE_VERCEL_URL as a fallback in the future
  return env.NEXT_PUBLIC_WWW_ORIGIN;
}