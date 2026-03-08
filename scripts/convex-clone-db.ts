#!/usr/bin/env bun
/**
 * Convex DB Clone/Backup/Restore Script
 *
 * Export, clone, or restore Convex Cloud databases.
 *
 * Usage:
 *   bun run scripts/convex-clone-db.ts export
 *   bun run scripts/convex-clone-db.ts clone
 *   bun run scripts/convex-clone-db.ts import --backup-path <zip>
 *
 * Commands:
 *   export  - Export DB to local backup
 *   import  - Import from local backup to target
 *   clone   - Export + Import in one operation
 *
 * Options:
 *   --env-file <path>      - Path to env file (auto-detected: .env.production if exists, else local env)
 *   --backup-dir <path>    - Backup directory (default: ~/Downloads/convex-backups)
 *   --backup-path <path>   - Specific backup file (for import command)
 *   --include-storage      - Include file storage in backup
 *   --yes, -y              - Skip confirmation prompts
 */

import { Command } from "commander";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import readline from "node:readline/promises";

// Check if URL is self-hosted (not Convex Cloud)
function isSelfHostedUrl(url: string): boolean {
  return !url.includes(".convex.cloud");
}

// Extract deployment name from Convex URL
// e.g., https://famous-camel-162.convex.cloud -> famous-camel-162
// e.g., https://api-kos4cos88kgkg4g0k0ww48c0.karldigi.dev -> api-kos4cos88kgkg4g0k0ww48c0 (self-hosted)
function extractDeploymentName(url: string): string {
  // Try Convex Cloud format first
  const cloudMatch = url.match(/https?:\/\/([^.]+)\.convex\.cloud/);
  if (cloudMatch) {
    return cloudMatch[1];
  }

  // Try self-hosted format (api-xxx.domain.tld)
  const selfHostedMatch = url.match(/https?:\/\/([^.]+)\.[^/]+/);
  if (selfHostedMatch) {
    return selfHostedMatch[1];
  }

  throw new Error(`Invalid Convex URL: ${url}`);
}

// Generate timestamped backup filename
function generateBackupFilename(deploymentName: string): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14); // YYYYMMDDHHMMSS
  return `${deploymentName}-${timestamp}.zip`;
}

// Load environment variables from file
async function loadEnvFile(envFilePath: string): Promise<Record<string, string>> {
  const content = await fs.readFile(envFilePath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

// Run convex CLI command
function runConvexCommand(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): { success: boolean; stdout: string; stderr: string } {
  // Merge provided env vars with process.env, with provided vars taking precedence
  const mergedEnv = { ...process.env, ...options?.env };

  const result = spawnSync("bunx", ["convex", ...args], {
    encoding: "utf-8",
    cwd: options?.cwd ?? path.join(process.cwd(), "packages/convex"),
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 500 * 1024 * 1024, // 500MB buffer for large exports
    env: mergedEnv,
  });

  return {
    success: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

interface ExportOptions {
  convexUrl: string;
  deployKey: string;
  backupDir: string;
  includeStorage: boolean;
}

async function exportDatabase(options: ExportOptions): Promise<string> {
  const deploymentName = extractDeploymentName(options.convexUrl);
  const filename = generateBackupFilename(deploymentName);
  const backupPath = path.join(options.backupDir, filename);

  // Ensure backup directory exists
  await fs.mkdir(options.backupDir, { recursive: true });

  console.log(`Exporting ${deploymentName} to ${backupPath}...`);

  const args = ["export", "--path", backupPath];
  if (options.includeStorage) {
    args.push("--include-file-storage");
  }

  const result = runConvexCommand(args, {
    env: { CONVEX_DEPLOY_KEY: options.deployKey },
  });

  if (!result.success) {
    console.error("Export failed:");
    console.error(result.stderr);
    throw new Error("Export failed");
  }

  console.log(result.stdout);
  console.log(`Export complete: ${backupPath}`);

  return backupPath;
}

interface ImportOptions {
  convexUrl: string;
  deployKey: string;
  siteUrl?: string;
  backupPath: string;
  skipConfirmation: boolean;
}

async function importDatabase(options: ImportOptions): Promise<void> {
  const deploymentName = extractDeploymentName(options.convexUrl);
  const selfHosted = isSelfHostedUrl(options.convexUrl);

  // Verify backup file exists
  try {
    await fs.access(options.backupPath);
  } catch {
    throw new Error(`Backup file not found: ${options.backupPath}`);
  }

  if (!options.skipConfirmation) {
    console.log(`\nWARNING: This will replace ALL data in deployment: ${deploymentName}`);
    console.log(`Backup file: ${options.backupPath}`);
    if (selfHosted) {
      console.log(`Target: Self-hosted (${options.convexUrl})`);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await rl.question("\nType 'yes' to confirm: ");
      if (answer.trim().toLowerCase() !== "yes") {
        console.log("Import cancelled.");
        process.exit(0);
      }
    } finally {
      rl.close();
    }
  }

  console.log(`\nImporting to ${deploymentName} from ${options.backupPath}...`);
  if (selfHosted) {
    console.log(`(Self-hosted: ${options.convexUrl})`);
  }

  const args = ["import", "--replace-all", options.backupPath];
  if (options.skipConfirmation) {
    args.push("--yes");
  }

  // Set environment variables for convex CLI
  // For self-hosted, map BACKUP_* vars to CONVEX_SELF_HOSTED_* vars required by CLI
  // For cloud, use CONVEX_DEPLOY_KEY
  const envVars: Record<string, string> = selfHosted
    ? {
        CONVEX_SELF_HOSTED_URL: options.convexUrl,
        CONVEX_SELF_HOSTED_ADMIN_KEY: options.deployKey,
      }
    : {
        CONVEX_DEPLOY_KEY: options.deployKey,
        NEXT_PUBLIC_CONVEX_URL: options.convexUrl,
      };
  if (options.siteUrl) {
    envVars.CONVEX_SITE_URL = options.siteUrl;
  }

  const result = runConvexCommand(args, { env: envVars });

  if (!result.success) {
    console.error("Import failed:");
    console.error(result.stderr);
    throw new Error("Import failed");
  }

  console.log(result.stdout);
  console.log("Import complete!");
}

interface Config {
  sourceUrl: string;
  sourceDeployKey: string;
  targetUrl?: string;
  targetDeployKey?: string;
  targetSiteUrl?: string;
  backupDir: string;
}

async function loadConfig(envFilePath?: string): Promise<Config> {
  let env: Record<string, string> = {};

  // Auto-detect env file
  if (!envFilePath) {
    const productionEnvPath = path.join(process.cwd(), ".env.production");
    try {
      await fs.access(productionEnvPath);
      envFilePath = productionEnvPath;
      console.log(`Using env file: ${envFilePath}`);
    } catch {
      // Fall back to process.env
      console.log("Using environment variables");
    }
  }

  if (envFilePath) {
    env = await loadEnvFile(envFilePath);
  }

  // Merge with process.env (env file takes precedence when specified)
  const getVar = (key: string): string | undefined => {
    return env[key] ?? process.env[key];
  };

  const sourceUrl = getVar("NEXT_PUBLIC_CONVEX_URL");
  const sourceDeployKey = getVar("CONVEX_DEPLOY_KEY");

  if (!sourceUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  }
  if (!sourceDeployKey) {
    throw new Error("CONVEX_DEPLOY_KEY is required");
  }

  const backupDir = path.join(os.homedir(), "Downloads", "convex-backups");

  return {
    sourceUrl,
    sourceDeployKey,
    targetUrl: getVar("BACKUP_NEXT_PUBLIC_CONVEX_URL"),
    targetDeployKey: getVar("BACKUP_CONVEX_DEPLOY_KEY"),
    targetSiteUrl: getVar("BACKUP_CONVEX_SITE_URL"),
    backupDir,
  };
}

const program = new Command()
  .name("convex-clone-db")
  .description("Export, clone, or restore Convex Cloud databases")
  .version("1.0.0");

program
  .command("export")
  .description("Export database to local backup")
  .option("--env-file <path>", "Path to env file")
  .option("--backup-dir <path>", "Backup directory")
  .option("--include-storage", "Include file storage in backup")
  .action(async (options) => {
    try {
      const config = await loadConfig(options.envFile);
      const backupDir = options.backupDir ?? config.backupDir;

      const backupPath = await exportDatabase({
        convexUrl: config.sourceUrl,
        deployKey: config.sourceDeployKey,
        backupDir,
        includeStorage: options.includeStorage ?? false,
      });

      console.log(`\nBackup saved to: ${backupPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("import")
  .description("Import from local backup to target deployment")
  .option("--env-file <path>", "Path to env file")
  .requiredOption("--backup-path <path>", "Path to backup file")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (options) => {
    try {
      const config = await loadConfig(options.envFile);

      if (!config.targetUrl) {
        throw new Error("BACKUP_NEXT_PUBLIC_CONVEX_URL is required for import");
      }
      if (!config.targetDeployKey) {
        throw new Error("BACKUP_CONVEX_DEPLOY_KEY is required for import");
      }

      await importDatabase({
        convexUrl: config.targetUrl,
        deployKey: config.targetDeployKey,
        siteUrl: config.targetSiteUrl,
        backupPath: options.backupPath,
        skipConfirmation: options.yes ?? false,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("clone")
  .description("Export from source and import to target in one operation")
  .option("--env-file <path>", "Path to env file")
  .option("--backup-dir <path>", "Backup directory")
  .option("--include-storage", "Include file storage in backup")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (options) => {
    try {
      const config = await loadConfig(options.envFile);
      const backupDir = options.backupDir ?? config.backupDir;

      if (!config.targetUrl) {
        throw new Error("BACKUP_NEXT_PUBLIC_CONVEX_URL is required for clone");
      }
      if (!config.targetDeployKey) {
        throw new Error("BACKUP_CONVEX_DEPLOY_KEY is required for clone");
      }

      const sourceDeploymentName = extractDeploymentName(config.sourceUrl);
      const targetDeploymentName = extractDeploymentName(config.targetUrl);

      console.log("=".repeat(60));
      console.log("Convex Database Clone");
      console.log("=".repeat(60));
      console.log(`Source: ${sourceDeploymentName}`);
      console.log(`Target: ${targetDeploymentName}`);
      console.log(`Backup Dir: ${backupDir}`);
      console.log("=".repeat(60));

      // Step 1: Export
      console.log("\n[1/2] Exporting from source...\n");
      const backupPath = await exportDatabase({
        convexUrl: config.sourceUrl,
        deployKey: config.sourceDeployKey,
        backupDir,
        includeStorage: options.includeStorage ?? false,
      });

      // Step 2: Import
      console.log("\n[2/2] Importing to target...\n");
      await importDatabase({
        convexUrl: config.targetUrl,
        deployKey: config.targetDeployKey,
        siteUrl: config.targetSiteUrl,
        backupPath,
        skipConfirmation: options.yes ?? false,
      });

      console.log("\n" + "=".repeat(60));
      console.log("Clone complete!");
      console.log(`Backup saved: ${backupPath}`);
      console.log("=".repeat(60));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

if (import.meta.main) {
  program.parse();
}
