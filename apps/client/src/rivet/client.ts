import { createRivetKit } from "@rivetkit/react";
import { createClient } from "rivetkit/client";
// Import ONLY the type from server - this provides e2e type safety
import type { registry } from "./types";

// Get the Rivet endpoint from environment or default to local dev
// Point to the manager port (6421) where actor routes are available
const RIVET_ENDPOINT = import.meta.env.VITE_RIVET_ENDPOINT ?? "http://localhost:6421";

// Create React hooks with full e2e type safety
export const { useActor } = createRivetKit<typeof registry>({
  endpoint: RIVET_ENDPOINT,
});

// Create a typed client for stateless operations
export const rivetClient = createClient<typeof registry>({
  endpoint: RIVET_ENDPOINT,
});

// Get or create a stable visitor ID
export function getVisitorId(): string {
  const key = "rivet-demo-visitor-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
