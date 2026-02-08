import { getUserFromRequest } from "@/lib/utils/auth";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const settingsRouter = new OpenAPIHono();

/**
 * Validates that a URL is safe to make server-side requests to.
 * Prevents SSRF by blocking private/internal IP ranges and metadata endpoints.
 */
function isAllowedBaseUrl(urlString: string): { allowed: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { allowed: false, reason: "Invalid URL format" };
  }

  // Only allow HTTPS
  if (url.protocol !== "https:") {
    return { allowed: false, reason: "Only HTTPS URLs are allowed" };
  }

  const hostname = url.hostname.toLowerCase();

  // Block localhost variants
  // Note: URL.hostname returns bracketed IPv6 (e.g., "[::1]"), so check both formats
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
    return { allowed: false, reason: "Localhost URLs are not allowed" };
  }

  // Block metadata endpoints (AWS, GCP, Azure)
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
    return { allowed: false, reason: "Metadata endpoints are not allowed" };
  }

  // Check for private IP ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    const [first, second] = octets;

    // 10.0.0.0/8
    if (first === 10) {
      return { allowed: false, reason: "Private IP ranges are not allowed" };
    }
    // 172.16.0.0/12
    if (first === 172 && second >= 16 && second <= 31) {
      return { allowed: false, reason: "Private IP ranges are not allowed" };
    }
    // 192.168.0.0/16
    if (first === 192 && second === 168) {
      return { allowed: false, reason: "Private IP ranges are not allowed" };
    }
    // 169.254.0.0/16 (link-local)
    if (first === 169 && second === 254) {
      return { allowed: false, reason: "Link-local addresses are not allowed" };
    }
    // 127.0.0.0/8 (loopback)
    if (first === 127) {
      return { allowed: false, reason: "Loopback addresses are not allowed" };
    }
  }

  return { allowed: true };
}

const TestAnthropicConnectionBody = z
  .object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
  })
  .openapi("TestAnthropicConnectionBody");

const TestAnthropicConnectionResult = z
  .object({
    success: z.boolean(),
    message: z.string(),
    details: z
      .object({
        statusCode: z.number().optional(),
        responseTime: z.number().optional(),
        endpoint: z.string(),
        modelsFound: z.number().optional(),
      })
      .optional(),
  })
  .openapi("TestAnthropicConnectionResult");

settingsRouter.openapi(
  createRoute({
    method: "post",
    path: "/settings/test-anthropic-connection",
    tags: ["Settings"],
    summary: "Test Anthropic base URL and API key connectivity",
    request: {
      body: {
        content: {
          "application/json": {
            schema: TestAnthropicConnectionBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Connection test result",
        content: {
          "application/json": {
            schema: TestAnthropicConnectionResult,
          },
        },
      },
      401: {
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.json(
        {
          success: false,
          message: "Unauthorized",
        },
        401
      );
    }

    const { baseUrl, apiKey } = c.req.valid("json");
    const normalizedBaseUrl = baseUrl
      .replace(/\/v1\/?$/, "")
      .replace(/\/+$/, "");

    // SSRF protection: validate the URL before making server-side requests
    const urlValidation = isAllowedBaseUrl(normalizedBaseUrl);
    if (!urlValidation.allowed) {
      return c.json({
        success: false,
        message: `Invalid base URL: ${urlValidation.reason}`,
        details: {
          endpoint: normalizedBaseUrl,
        },
      });
    }

    const endpoint = `${normalizedBaseUrl}/v1/models`;
    const startTime = Date.now();

    try {
      const authHeaders: Array<Record<string, string>> = [
        { Authorization: `Bearer ${apiKey}` },
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      ];

      const errorMessages: Record<number, string> = {
        401: "Authentication failed - check your API key",
        403: "Permission denied - API key may lack required permissions",
        404: "Endpoint not found - check your base URL",
        429: "Rate limited - too many requests",
        500: "Server error - endpoint returned an internal error",
        502: "Bad gateway - proxy or endpoint issue",
        503: "Service unavailable - endpoint is temporarily down",
      };

      let lastNetworkError: Error | null = null;
      let sawUnauthorized = false;

      for (const headers of authHeaders) {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "GET",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(10000),
          });
        } catch (fetchError) {
          lastNetworkError =
            fetchError instanceof Error ? fetchError : new Error(String(fetchError));
          continue;
        }

        if (response.ok) {
          let modelsCount = 0;
          try {
            const data = await response.json();
            modelsCount = Array.isArray(data?.data) ? data.data.length : 0;
          } catch {
            // Treat non-JSON success responses as a valid connection.
          }

          return c.json({
            success: true,
            message: "Connection successful - endpoint and API key validated",
            details: {
              statusCode: response.status,
              responseTime: Date.now() - startTime,
              endpoint,
              modelsFound: modelsCount,
            },
          });
        }

        if (response.status === 401) {
          sawUnauthorized = true;
          continue;
        }

        return c.json({
          success: false,
          message: errorMessages[response.status] || `API error: HTTP ${response.status}`,
          details: {
            statusCode: response.status,
            responseTime: Date.now() - startTime,
            endpoint,
          },
        });
      }

      if (lastNetworkError && !sawUnauthorized) {
        return c.json({
          success: false,
          message: `Connection failed - endpoint unreachable: ${lastNetworkError.message}`,
          details: {
            responseTime: Date.now() - startTime,
            endpoint,
          },
        });
      }

      return c.json({
        success: false,
        message: "Authentication failed - check your API key",
        details: {
          statusCode: 401,
          responseTime: Date.now() - startTime,
          endpoint,
        },
      });
    } catch (error) {
      return c.json({
        success: false,
        message: `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
        details: {
          endpoint,
        },
      });
    }
  }
);
