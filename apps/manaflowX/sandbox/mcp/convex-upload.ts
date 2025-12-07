#!/usr/bin/env bun
/**
 * Convex Upload MCP Server
 *
 * A minimal MCP server that provides an image upload tool for browser agents.
 * This server reads the Convex URL from /root/.xagi/config.json and uploads
 * images to the Convex storage endpoint.
 *
 * Usage:
 *   bun /root/mcp/convex-upload.ts
 *
 * The tool returns the public URL and instructions to render the image in markdown.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Config interface
interface XagiConfig {
  convexUrl: string;
  jwt: string;
}

// Cached config
let cachedConfig: XagiConfig | null = null;

// Load config from /root/.xagi/config.json
async function loadConfig(): Promise<XagiConfig | null> {
  if (cachedConfig) return cachedConfig;

  const configPath = "/root/.xagi/config.json";
  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();
    if (!exists) {
      console.error("[convex-upload] Config file not found:", configPath);
      return null;
    }
    const content = await file.text();
    cachedConfig = JSON.parse(content) as XagiConfig;
    console.error("[convex-upload] Config loaded successfully");
    return cachedConfig;
  } catch (error) {
    console.error("[convex-upload] Failed to load config:", error);
    return null;
  }
}

// Derive upload endpoint from convexUrl (which points to /opencode_hook)
function getUploadUrl(config: XagiConfig): string {
  // convexUrl is like "https://xxx.convex.site/opencode_hook"
  // We need "https://xxx.convex.site/upload_image"
  const baseUrl = config.convexUrl.replace(/\/opencode_hook$/, "");
  return `${baseUrl}/upload_image`;
}

// Create MCP server
const server = new Server(
  {
    name: "convex-upload",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "upload_image",
        description: `Upload an image to Convex storage and get a public URL.
Use this tool after taking a screenshot or capturing an image to make it permanently accessible.
The tool returns a public URL that you MUST render in your response using markdown image syntax.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            data: {
              type: "string",
              description:
                "Base64-encoded image data. Can be raw base64 or a data URL (data:image/png;base64,...).",
            },
            filename: {
              type: "string",
              description:
                "Optional filename for the image (e.g., 'screenshot.png'). Defaults to 'screenshot-{timestamp}.png'.",
            },
            mimeType: {
              type: "string",
              description:
                "Optional MIME type (e.g., 'image/png', 'image/jpeg'). Defaults to 'image/png'.",
            },
            description: {
              type: "string",
              description:
                "A brief description of what the image shows. This will be used as alt text.",
            },
          },
          required: ["data"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "upload_image") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Unknown tool: ${request.params.name}`,
        },
      ],
      isError: true,
    };
  }

  const args = request.params.arguments as {
    data: string;
    filename?: string;
    mimeType?: string;
    description?: string;
  };

  if (!args.data) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: Missing required 'data' parameter (base64-encoded image)",
        },
      ],
      isError: true,
    };
  }

  // Load config
  const config = await loadConfig();
  if (!config) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: Could not load config from /root/.xagi/config.json. Make sure the config file exists.",
        },
      ],
      isError: true,
    };
  }

  const uploadUrl = getUploadUrl(config);
  console.error(`[convex-upload] Uploading to ${uploadUrl}`);

  try {
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: args.data,
        filename: args.filename,
        mimeType: args.mimeType,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        content: [
          {
            type: "text" as const,
            text: `Error uploading image: ${response.status} ${text}`,
          },
        ],
        isError: true,
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      url?: string;
      storageId?: string;
      filename?: string;
      error?: string;
    };

    if (!result.success || !result.url) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error uploading image: ${result.error || "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }

    const altText = args.description || args.filename || "Screenshot";
    const markdownImage = `![${altText}](${result.url})`;

    return {
      content: [
        {
          type: "text" as const,
          text: `Image uploaded successfully!

**URL:** ${result.url}
**Storage ID:** ${result.storageId}
**Filename:** ${result.filename}

**IMPORTANT:** You MUST include this image in your response to the user by using the following markdown:

${markdownImage}

Copy the markdown above into your response so the user can see the image.`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[convex-upload] Upload error:", errorMessage);
    return {
      content: [
        {
          type: "text" as const,
          text: `Error uploading image: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[convex-upload] MCP server started");
}

main().catch((error) => {
  console.error("[convex-upload] Fatal error:", error);
  process.exit(1);
});
