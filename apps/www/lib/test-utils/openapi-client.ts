import { createClient } from "@cmux/www-openapi-client/client";
import { honoTestFetch } from "@/lib/utils/hono-test-fetch";

// The generated client expects Bun's fetch type (which includes `preconnect`).
// Our Hono test fetch is a simple function, so augment it with a no-op
// `preconnect` method to satisfy the type without changing runtime behavior.
const fetchCompat: typeof fetch = Object.assign(
  ((input: RequestInfo | URL, init?: RequestInit) =>
    honoTestFetch(input, init)) as typeof fetch,
  {
    preconnect: async () => {},
  }
);

export const testApiClient = createClient({
  fetch: fetchCompat,
  baseUrl: "http://localhost",
});
