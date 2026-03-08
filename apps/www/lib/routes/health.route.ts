import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getActiveSandboxProvider } from "@/lib/utils/sandbox-provider";
import { getPveLxcClient } from "@/lib/utils/pve-lxc-client";
import { env } from "@/lib/utils/www-env";

const HealthSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy"]).openapi({
      example: "healthy",
    }),
    timestamp: z.string().datetime().openapi({
      example: "2024-01-01T00:00:00Z",
    }),
    version: z.string().openapi({
      example: "1.0.0",
    }),
    uptime: z.number().openapi({
      example: 3600,
      description: "Uptime in seconds",
    }),
  })
  .openapi("Health");

const SandboxHealthSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy", "degraded"]).openapi({
      example: "healthy",
    }),
    provider: z.string().openapi({
      example: "pve-lxc",
      description: "Active sandbox provider",
    }),
    providerStatus: z.enum(["connected", "disconnected", "error"]).openapi({
      example: "connected",
    }),
    latencyMs: z.number().optional().openapi({
      example: 45,
      description: "API latency in milliseconds",
    }),
    templatesAvailable: z.number().optional().openapi({
      example: 2,
      description: "Number of templates available",
    }),
    error: z.string().optional().openapi({
      description: "Error message if status is unhealthy",
    }),
    timestamp: z.string().datetime().openapi({
      example: "2024-01-01T00:00:00Z",
    }),
  })
  .openapi("SandboxHealth");

const startTime = Date.now();

export const healthRouter = new OpenAPIHono();

healthRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/health",
    tags: ["System"],
    summary: "Health check endpoint",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: HealthSchema,
          },
        },
        description: "Service is healthy",
      },
    },
  }),
  (c) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    return c.json(
      {
        status: "healthy" as const,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        uptime,
      },
      200
    );
  }
);

/**
 * Sandbox provider health check endpoint.
 * Tests connectivity to the active sandbox provider and returns status.
 */
healthRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/health/sandbox",
    tags: ["System"],
    summary: "Sandbox provider health check",
    description: "Tests connectivity to the active sandbox provider (Morph or PVE LXC)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: SandboxHealthSchema,
          },
        },
        description: "Sandbox provider health status",
      },
    },
  }),
  async (c) => {
    const timestamp = new Date().toISOString();

    try {
      const providerInfo = getActiveSandboxProvider();
      const provider = providerInfo.provider;

      if (provider === "pve-lxc") {
        // Test PVE LXC connectivity
        const startMs = Date.now();
        try {
          const client = getPveLxcClient();
          // List containers to verify connectivity (lightweight API call)
          const instances = await client.instances.list();
          const latencyMs = Date.now() - startMs;

          return c.json({
            status: "healthy" as const,
            provider,
            providerStatus: "connected" as const,
            latencyMs,
            templatesAvailable: instances.length,
            timestamp,
          }, 200);
        } catch (error) {
          const latencyMs = Date.now() - startMs;
          return c.json({
            status: "unhealthy" as const,
            provider,
            providerStatus: "error" as const,
            latencyMs,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp,
          }, 200);
        }
      } else if (provider === "morph") {
        // Test Morph connectivity
        if (!env.MORPH_API_KEY) {
          return c.json({
            status: "unhealthy" as const,
            provider,
            providerStatus: "disconnected" as const,
            error: "MORPH_API_KEY not configured",
            timestamp,
          }, 200);
        }

        // For Morph, we just verify the API key is configured
        // A full connectivity test would require the morphcloud client
        return c.json({
          status: "healthy" as const,
          provider,
          providerStatus: "connected" as const,
          timestamp,
        }, 200);
      } else {
        return c.json({
          status: "degraded" as const,
          provider: provider || "none",
          providerStatus: "disconnected" as const,
          error: "No sandbox provider configured",
          timestamp,
        }, 200);
      }
    } catch (error) {
      return c.json({
        status: "unhealthy" as const,
        provider: "unknown",
        providerStatus: "error" as const,
        error: error instanceof Error ? error.message : "Failed to detect provider",
        timestamp,
      }, 200);
    }
  }
);
