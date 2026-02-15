#!/usr/bin/env bun
/**
 * Test script for AI Gateway endpoints
 * Usage: bun run --env-file .env scripts/test-ai-gateway.ts [provider]
 *
 * Examples:
 *   bun run --env-file .env scripts/test-ai-gateway.ts           # Test all providers
 *   bun run --env-file .env scripts/test-ai-gateway.ts gemini    # Test Gemini only
 *   bun run --env-file .env scripts/test-ai-gateway.ts openai    # Test OpenAI only
 *   bun run --env-file .env scripts/test-ai-gateway.ts anthropic # Test Anthropic only
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import {
  CLOUDFLARE_OPENAI_BASE_URL,
  CLOUDFLARE_ANTHROPIC_BASE_URL,
  CLOUDFLARE_GEMINI_BASE_URL,
} from "@cmux/shared";

// Configuration
const CONFIG = {
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "AIGATEWAY_OPENAI_BASE_URL",
    defaultBaseUrl: CLOUDFLARE_OPENAI_BASE_URL,
    models: ["gpt-5-mini", "gpt-5-nano", "gpt-4o-mini"],
  },
  anthropic: {
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "AIGATEWAY_ANTHROPIC_BASE_URL",
    defaultBaseUrl: CLOUDFLARE_ANTHROPIC_BASE_URL,
    models: ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5"],
  },
  gemini: {
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "AIGATEWAY_GEMINI_BASE_URL",
    defaultBaseUrl: CLOUDFLARE_GEMINI_BASE_URL,
    models: ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-2.5-pro"],
  },
};

type ProviderName = keyof typeof CONFIG;

interface TestResult {
  provider: string;
  model: string;
  baseUrl: string;
  success: boolean;
  response?: string;
  error?: string;
  latencyMs: number;
}

function isValidApiKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.includes("placeholder")) return false;
  if (key.startsWith("sk_place")) return false;
  return true;
}

function createProvider(
  providerName: ProviderName,
  modelId: string
): { model: LanguageModel; baseUrl: string } | null {
  const config = CONFIG[providerName];
  const apiKey = process.env[config.apiKeyEnv];
  const baseUrl = process.env[config.baseUrlEnv] || config.defaultBaseUrl;

  if (!isValidApiKey(apiKey)) {
    return null;
  }

  switch (providerName) {
    case "openai": {
      const openai = createOpenAI({ apiKey, baseURL: baseUrl });
      return { model: openai(modelId), baseUrl };
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey, baseURL: baseUrl });
      return { model: anthropic(modelId), baseUrl };
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey, baseURL: baseUrl });
      return { model: google(modelId), baseUrl };
    }
    default:
      return null;
  }
}

async function testModel(
  providerName: ProviderName,
  modelId: string
): Promise<TestResult> {
  const start = Date.now();
  const config = CONFIG[providerName];
  const baseUrl = process.env[config.baseUrlEnv] || config.defaultBaseUrl;

  const result: TestResult = {
    provider: providerName,
    model: modelId,
    baseUrl,
    success: false,
    latencyMs: 0,
  };

  const providerConfig = createProvider(providerName, modelId);
  if (!providerConfig) {
    result.error = `No valid API key for ${providerName} (${config.apiKeyEnv})`;
    result.latencyMs = Date.now() - start;
    return result;
  }

  try {
    const { text } = await generateText({
      model: providerConfig.model,
      prompt: "Say 'Hello from AI Gateway test!' in exactly 5 words.",
      maxOutputTokens: 50,
    });

    result.success = true;
    result.response = text.trim();
    result.latencyMs = Date.now() - start;
  } catch (error) {
    result.error =
      error instanceof Error ? error.message : "Unknown error";
    result.latencyMs = Date.now() - start;
  }

  return result;
}

async function testProvider(providerName: ProviderName): Promise<TestResult[]> {
  const config = CONFIG[providerName];
  const results: TestResult[] = [];

  console.log(`\n--- Testing ${providerName.toUpperCase()} ---`);
  console.log(`API Key: ${config.apiKeyEnv}`);
  console.log(`Base URL Env: ${config.baseUrlEnv}`);
  console.log(
    `Using Base URL: ${process.env[config.baseUrlEnv] || config.defaultBaseUrl}`
  );

  for (const modelId of config.models) {
    process.stdout.write(`  Testing ${modelId}... `);
    const result = await testModel(providerName, modelId);
    results.push(result);

    if (result.success) {
      console.log(`OK (${result.latencyMs}ms) - "${result.response}"`);
    } else {
      console.log(`FAILED (${result.latencyMs}ms) - ${result.error}`);
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const specificProvider = args[0]?.toLowerCase() as ProviderName | undefined;

  console.log("===========================================");
  console.log("AI Gateway Endpoint Test");
  console.log("===========================================");

  // Show env status
  console.log("\nEnvironment Variables:");
  for (const [name, config] of Object.entries(CONFIG)) {
    const apiKey = process.env[config.apiKeyEnv];
    const baseUrl = process.env[config.baseUrlEnv];
    const hasValidKey = isValidApiKey(apiKey);
    console.log(
      `  ${name}: API_KEY=${hasValidKey ? "SET" : "NOT SET"}, BASE_URL=${baseUrl || "(default)"}`
    );
  }

  const allResults: TestResult[] = [];

  if (specificProvider && CONFIG[specificProvider]) {
    const results = await testProvider(specificProvider);
    allResults.push(...results);
  } else if (specificProvider) {
    console.error(`\nUnknown provider: ${specificProvider}`);
    console.error(`Available providers: ${Object.keys(CONFIG).join(", ")}`);
    process.exit(1);
  } else {
    // Test all providers
    for (const providerName of Object.keys(CONFIG) as ProviderName[]) {
      const results = await testProvider(providerName);
      allResults.push(...results);
    }
  }

  // Summary
  console.log("\n===========================================");
  console.log("Summary");
  console.log("===========================================");

  const successful = allResults.filter((r) => r.success);
  const failed = allResults.filter((r) => !r.success);

  console.log(`Total: ${allResults.length} tests`);
  console.log(`Passed: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed tests:");
    for (const result of failed) {
      console.log(`  - ${result.provider}/${result.model}: ${result.error}`);
    }
  }

  if (successful.length > 0) {
    console.log("\nWorking models:");
    for (const result of successful) {
      console.log(
        `  - ${result.provider}/${result.model} (${result.latencyMs}ms)`
      );
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(console.error);
