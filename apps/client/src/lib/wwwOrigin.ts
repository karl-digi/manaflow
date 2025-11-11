import { normalizeOrigin } from "@cmux/shared";
import { env } from "@/client-env";

// Use VITE_VERCEL_URL as a fallback if NEXT_PUBLIC_WWW_ORIGIN is not set
// This allows deployment on Vercel without additional configuration
export const WWW_ORIGIN = normalizeOrigin(env.NEXT_PUBLIC_WWW_ORIGIN);
