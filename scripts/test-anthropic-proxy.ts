/**
 * Minimal test script for Anthropic proxy with structured output.
 *
 * Usage:
 *   CONVEX_SITE_URL=https://famous-camel-162.convex.site bun scripts/test-anthropic-proxy.ts
 *
 * This tests the Anthropic proxy at ${CONVEX_SITE_URL}/api/anthropic
 * with structured JSON output using tool_use.
 */

export {};

const convexSiteUrlRaw = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexSiteUrlRaw) {
  console.error("Error: CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL is required");
  process.exit(1);
}

// Convert .convex.cloud to .convex.site for HTTP endpoints
const convexSiteUrl = convexSiteUrlRaw.trim().replace(".convex.cloud", ".convex.site");

const baseUrl = `${convexSiteUrl}/api/anthropic`;
const apiKey = "sk_placeholder_cmux_anthropic_api_key";

console.log("=== Anthropic Proxy Test ===\n");
console.log(`Base URL: ${baseUrl}`);
console.log(`Model: claude-sonnet-4-20250514\n`);

// Define a tool for structured output
const structuredOutputTool = {
  name: "provide_response",
  description: "Provide a structured response with greeting, number, and facts",
  input_schema: {
    type: "object",
    required: ["greeting", "number", "facts"],
    properties: {
      greeting: { type: "string", description: "A friendly greeting" },
      number: { type: "number", description: "A random number between 1 and 100" },
      facts: {
        type: "array",
        items: { type: "string" },
        description: "Three interesting facts about programming",
      },
    },
  },
};

const requestBody = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  tools: [structuredOutputTool],
  tool_choice: { type: "tool", name: "provide_response" },
  messages: [
    {
      role: "user",
      content:
        "Please provide a friendly greeting, a random number between 1 and 100, and three interesting facts about programming.",
    },
  ],
};

console.log("Sending request...\n");

try {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Request failed (${response.status}): ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();

  console.log("=== Response ===\n");
  console.log(`Model: ${data.model}`);
  console.log(`Stop reason: ${data.stop_reason}`);
  console.log(
    `Usage: ${data.usage?.input_tokens} input, ${data.usage?.output_tokens} output tokens\n`
  );

  // Extract tool use result
  const toolUse = data.content?.find(
    (block: { type: string }) => block.type === "tool_use"
  );

  if (toolUse) {
    console.log("=== Structured Output ===\n");
    console.log(JSON.stringify(toolUse.input, null, 2));

    console.log("\n=== Parsed Values ===\n");
    console.log(`Greeting: ${toolUse.input.greeting}`);
    console.log(`Number: ${toolUse.input.number}`);
    console.log(`Facts:`);
    toolUse.input.facts.forEach((fact: string, i: number) => {
      console.log(`  ${i + 1}. ${fact}`);
    });

    console.log("\n=== Test Passed ===");
  } else {
    console.log("No tool_use in response:");
    console.log(JSON.stringify(data.content, null, 2));
  }
} catch (error) {
  console.error("Request error:", error);
  process.exit(1);
}
