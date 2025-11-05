#!/usr/bin/env bun

/**
 * Script to download all logs from Cloudflare AI Gateway
 *
 * Usage:
 *   CLOUDFLARE_API_KEY=your_key bun scripts/download-cloudflare-ai-logs.ts
 *
 * Or using API Token:
 *   CLOUDFLARE_API_TOKEN=your_token bun scripts/download-cloudflare-ai-logs.ts
 *
 * Optional environment variables:
 *   CLOUDFLARE_EMAIL - Required if using API Key (not needed for API Token)
 *   OUTPUT_FILE - Output file path (default: cloudflare-ai-gateway-logs.json)
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ACCOUNT_ID = "0c1675e0def6de1ab3a50a4e17dc5656";
const GATEWAY_ID = "cmux-heatmap";
const PER_PAGE = 50; // Maximum allowed by the API

interface CloudflareLog {
  id: string;
  created_at: string;
  provider?: string;
  model?: string;
  success?: boolean;
  cached?: boolean;
  duration?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  [key: string]: unknown;
}

interface CloudflareLogsResponse {
  result: CloudflareLog[];
  result_info: {
    count: number;
    page: number;
    per_page: number;
    total_count: number;
    [key: string]: unknown;
  };
  success: boolean;
  errors?: Array<{ message: string }>;
}

async function fetchLogsPage(page: number): Promise<CloudflareLogsResponse> {
  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const email = process.env.CLOUDFLARE_EMAIL;

  if (!apiKey && !apiToken) {
    throw new Error(
      "Either CLOUDFLARE_API_KEY or CLOUDFLARE_API_TOKEN must be set"
    );
  }

  if (apiKey && !email) {
    throw new Error("CLOUDFLARE_EMAIL must be set when using CLOUDFLARE_API_KEY");
  }

  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-gateway/gateways/${GATEWAY_ID}/logs`
  );
  url.searchParams.set("page", page.toString());
  url.searchParams.set("per_page", PER_PAGE.toString());
  url.searchParams.set("order_by", "created_at");
  url.searchParams.set("order_by_direction", "asc"); // Oldest first for consistent ordering

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  } else if (apiKey && email) {
    headers["X-Auth-Key"] = apiKey;
    headers["X-Auth-Email"] = email;
  }

  console.log(`Fetching page ${page}...`);
  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch logs (page ${page}): ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const data = (await response.json()) as CloudflareLogsResponse;

  if (!data.success) {
    throw new Error(
      `API returned success=false: ${JSON.stringify(data.errors)}`
    );
  }

  return data;
}

async function downloadAllLogs(): Promise<CloudflareLog[]> {
  const allLogs: CloudflareLog[] = [];
  let page = 1;
  let totalPages = 1;

  console.log("Starting log download...");
  console.log(`Account ID: ${ACCOUNT_ID}`);
  console.log(`Gateway ID: ${GATEWAY_ID}\n`);

  // Fetch first page to get total count
  const firstPage = await fetchLogsPage(page);
  allLogs.push(...firstPage.result);

  const totalCount = firstPage.result_info.total_count;
  totalPages = Math.ceil(totalCount / PER_PAGE);

  console.log(`Total logs: ${totalCount}`);
  console.log(`Total pages: ${totalPages}`);
  console.log(`Logs fetched: ${firstPage.result.length}\n`);

  // Fetch remaining pages
  for (page = 2; page <= totalPages; page++) {
    const pageData = await fetchLogsPage(page);
    allLogs.push(...pageData.result);
    console.log(`Logs fetched: ${allLogs.length}/${totalCount}`);

    // Add a small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\nDownload complete! Total logs fetched: ${allLogs.length}`);
  return allLogs;
}

async function main() {
  try {
    const logs = await downloadAllLogs();

    const outputFile = process.env.OUTPUT_FILE || "cloudflare-ai-gateway-logs.json";
    const outputPath = resolve(process.cwd(), outputFile);

    await writeFile(outputPath, JSON.stringify(logs, null, 2), "utf-8");

    console.log(`\nLogs saved to: ${outputPath}`);
    console.log(`File size: ${(JSON.stringify(logs).length / 1024 / 1024).toFixed(2)} MB`);

    // Print summary statistics
    const successCount = logs.filter((log) => log.success).length;
    const cachedCount = logs.filter((log) => log.cached).length;
    const providers = new Set(logs.map((log) => log.provider).filter(Boolean));
    const models = new Set(logs.map((log) => log.model).filter(Boolean));

    console.log("\n=== Summary ===");
    console.log(`Total logs: ${logs.length}`);
    console.log(`Successful requests: ${successCount} (${((successCount / logs.length) * 100).toFixed(1)}%)`);
    console.log(`Cached requests: ${cachedCount} (${((cachedCount / logs.length) * 100).toFixed(1)}%)`);
    console.log(`Unique providers: ${providers.size}`);
    console.log(`Unique models: ${models.size}`);

    if (providers.size > 0) {
      console.log(`\nProviders: ${Array.from(providers).join(", ")}`);
    }
  } catch (error) {
    console.error("Error downloading logs:", error);
    process.exit(1);
  }
}

main();
