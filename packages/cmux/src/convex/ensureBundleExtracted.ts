import { $ } from "bun";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "../logger";
import { spawn } from "node:child_process";
import { fetchLatestGitHubRelease, normalizeVersion } from "../utils/githubReleaseUtils";

// @ts-expect-error this is a real file bundled at build time
import cmux_bundle_zip from "../assets/cmux-bundle.zip" with { type: "file" };

export interface EnsureResult {
  didExtract: boolean;
  bundleVersion: string;
  githubVersion?: string;
}

export async function ensureBundleExtracted(convexDir: string): Promise<EnsureResult> {
  await logger.info(`Creating directory: ${convexDir}`);
  const dirStart = performance.now();
  await fs.mkdir(convexDir, { recursive: true });
  await logger.info(`Directory creation took ${(performance.now() - dirStart).toFixed(2)}ms`);

  const versionFilePath = path.resolve(convexDir, ".cmux-version");

  // Read version from embedded zip
  const tempZipPath = path.join(os.tmpdir(), `cmux-bundle-${Date.now()}.zip`);
  const zipData = await fs.readFile(cmux_bundle_zip);
  await fs.writeFile(tempZipPath, zipData);

  const tempVersionCheckDir = path.join(os.tmpdir(), `cmux-version-check-${Date.now()}`);
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn("unzip", ["-jo", tempZipPath, "cmux-bundle/package.json", "-d", tempVersionCheckDir], { stdio: "ignore" });
      p.on("close", (code: number) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
      p.on("error", reject);
    });
  } catch (error) {
    await logger.error(`Failed to extract package.json: ${error}`);
    throw error;
  }
  const bundlePackageJson = JSON.parse(await fs.readFile(path.join(tempVersionCheckDir, "package.json"), "utf8"));
  let bundleVersion: string = bundlePackageJson.version;
  await fs.rm(tempVersionCheckDir, { recursive: true, force: true });

  // Check for GitHub updates if auto-update is enabled
  let githubVersion: string | undefined;
  let githubZipPath: string | undefined;
  const autoUpdate = process.env.CMUX_AUTO_UPDATE === "true" || process.env.CMUX_AUTO_UPDATE === "1";

  if (autoUpdate) {
    await logger.info("Auto-update enabled, checking GitHub for latest release...");
    const latestRelease = await fetchLatestGitHubRelease(true); // Include draft releases

    if (latestRelease) {
      githubVersion = normalizeVersion(latestRelease.tag_name);
      await logger.info(`Latest GitHub release: ${githubVersion} (draft: ${latestRelease.draft})`);

      // Find the cmux-bundle.zip asset
      const bundleAsset = latestRelease.assets.find(asset =>
        asset.name === "cmux-bundle.zip"
      );

      if (bundleAsset && githubVersion !== bundleVersion) {
        await logger.info(`Newer version available on GitHub: ${githubVersion} (current bundle: ${bundleVersion})`);
        // Download the new bundle
        githubZipPath = path.join(os.tmpdir(), `cmux-github-bundle-${Date.now()}.zip`);

        try {
          await logger.info(`Downloading new version from GitHub: ${bundleAsset.browser_download_url}`);
          const downloadHeaders: Record<string, string> = {
            "Accept": "application/octet-stream",
          };
          if (process.env.GITHUB_TOKEN) {
            downloadHeaders["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
          }

          const downloadResponse = await fetch(bundleAsset.browser_download_url, {
            headers: downloadHeaders,
            redirect: "follow"
          });

          if (downloadResponse.ok) {
            const buffer = await downloadResponse.arrayBuffer();
            await fs.writeFile(githubZipPath, Buffer.from(buffer));
            await logger.info(`Successfully downloaded GitHub release to ${githubZipPath}`);
            // Update bundleVersion to the GitHub version for the upgrade process
            bundleVersion = githubVersion;
          } else {
            await logger.error(`Failed to download GitHub release: ${downloadResponse.status}`);
            githubZipPath = undefined;
          }
        } catch (error) {
          await logger.error(`Error downloading GitHub release: ${error}`);
          githubZipPath = undefined;
        }
      } else if (githubVersion === bundleVersion) {
        await logger.info(`Already at latest GitHub version: ${githubVersion}`);
      } else if (!bundleAsset) {
        await logger.info(`No cmux-bundle.zip found in GitHub release ${githubVersion}`);
      }
    } else {
      await logger.info("Could not fetch latest GitHub release");
    }
  }

  // Use GitHub zip if available, otherwise use embedded bundle
  const zipToUse = githubZipPath || tempZipPath;

  // Decide whether to extract
  let shouldExtract = false;
  let isUpgrade = false;
  try {
    const currentVersion = (await fs.readFile(versionFilePath, "utf8")).trim();
    const shouldUpgrade = currentVersion !== bundleVersion || process.env.FORCE_UPGRADE === "true";
    await logger.info(`shouldUpgrade: ${shouldUpgrade}`);
    if (shouldUpgrade) {
      await logger.info(`Version changed from ${currentVersion} to ${bundleVersion}, upgrading...`);
      shouldExtract = true;
      isUpgrade = true;
    } else {
      await logger.info(`Already running version ${bundleVersion}, skipping extraction`);
    }
  } catch {
    await logger.info(`Fresh installation of version ${bundleVersion}`);
    shouldExtract = true;
    isUpgrade = false;
  }

  if (shouldExtract) {
    await logger.info("Extracting cmux bundle...");
    const tempExtractDir = path.join(os.tmpdir(), `cmux-extract-${Date.now()}`);
    await $`unzip -q -o ${zipToUse} -d ${tempExtractDir}`.quiet();

    if (isUpgrade) {
      await logger.info("Upgrading cmux, preserving user data...");
      const sqliteDbPath = path.join(convexDir, "convex_local_backend.sqlite3");
      const convexStoragePath = path.join(convexDir, "convex_local_storage");
      const logsPath = path.join(convexDir, "logs");
      const tempBackupDir = path.join(os.tmpdir(), `cmux-backup-${Date.now()}`);
      await fs.mkdir(tempBackupDir, { recursive: true });

      const hasDb = await fs.access(sqliteDbPath).then(() => true).catch(() => false);
      if (hasDb) await $`cp ${sqliteDbPath} ${tempBackupDir}/`;

      const hasStorage = await fs.access(convexStoragePath).then(() => true).catch(() => false);
      if (hasStorage) await $`rsync -aq ${convexStoragePath}/ ${tempBackupDir}/convex_local_storage/`;

      const hasLogs = await fs.access(logsPath).then(() => true).catch(() => false);
      if (hasLogs) await $`rsync -aq ${logsPath}/ ${tempBackupDir}/logs/`;

      await fs.rm(convexDir, { recursive: true, force: true });
      await fs.mkdir(convexDir, { recursive: true });
      await $`mv ${tempExtractDir}/cmux-bundle/* ${convexDir}/`;

      if (hasDb) await $`mv ${tempBackupDir}/convex_local_backend.sqlite3 ${convexDir}/`;
      if (hasStorage) {
        await $`rm -rf ${convexDir}/convex_local_storage`;
        await $`rsync -aq ${tempBackupDir}/convex_local_storage/ ${convexDir}/convex_local_storage/`;
      }
      if (hasLogs) await $`rsync -aq ${tempBackupDir}/logs/ ${convexDir}/logs/`;
      await $`rm -rf ${tempBackupDir}`;
      await logger.info("Upgrade complete!");
    } else {
      // Fresh install: preserve existing logs if any
      const logsPath = path.join(convexDir, "logs");
      const hasLogs = await fs.access(logsPath).then(() => true).catch(() => false);
      let tempLogsBackup: string | null = null;
      if (hasLogs) {
        tempLogsBackup = path.join(os.tmpdir(), `cmux-logs-backup-${Date.now()}`);
        await $`rsync -aq ${logsPath}/ ${tempLogsBackup}/`;
      }
      await fs.rm(convexDir, { recursive: true, force: true });
      await fs.mkdir(convexDir, { recursive: true });
      await $`mv ${tempExtractDir}/cmux-bundle/* ${convexDir}/`;
      if (tempLogsBackup) {
        await fs.mkdir(logsPath, { recursive: true });
        await $`rsync -aq ${tempLogsBackup}/ ${logsPath}/`;
        await $`rm -rf ${tempLogsBackup}`;
      }
    }
    await $`rm -rf ${tempExtractDir}`;
    await fs.writeFile(versionFilePath, bundleVersion);
    await logger.info(`Saved version ${bundleVersion}`);
  }

  // Cleanup temp files
  await fs.unlink(tempZipPath);
  if (githubZipPath) {
    try {
      await fs.unlink(githubZipPath);
    } catch (error) {
      await logger.error(`Failed to cleanup GitHub zip: ${error}`);
    }
  }

  return { didExtract: shouldExtract, bundleVersion, githubVersion };
}
