import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import { serverLogger } from "./utils/fileLogger";

const execAsync = promisify(exec);

export interface ArchiveLocalRepoOptions {
  localPath: string;
  targetDir: string;
  branch?: string;
}

export interface ArchiveLocalRepoResult {
  success: boolean;
  archivePath?: string;
  extractedPath?: string;
  error?: string;
}

/**
 * Archives a local git repository using git archive and extracts it to a target directory.
 * This creates a clean copy of the repo without the .git directory, suitable for use in containers.
 *
 * @param options - Options for archiving the local repo
 * @returns Result containing the archive and extracted paths, or an error
 */
export async function archiveLocalRepo(
  options: ArchiveLocalRepoOptions
): Promise<ArchiveLocalRepoResult> {
  const { localPath, targetDir, branch = "HEAD" } = options;

  try {
    // Resolve ~ to home directory
    let resolvedPath = localPath;
    if (localPath.startsWith("~")) {
      resolvedPath = localPath.replace(/^~/, os.homedir());
    }

    // Verify the directory exists and is a git repo
    try {
      await fs.access(resolvedPath);
      await fs.access(path.join(resolvedPath, ".git"));
    } catch (error) {
      return {
        success: false,
        error: "Local path is not a valid git repository",
      };
    }

    // Create target directory if it doesn't exist
    await fs.mkdir(targetDir, { recursive: true });

    // Generate unique archive filename
    const repoName = path.basename(resolvedPath);
    const timestamp = Date.now();
    const archiveFilename = `${repoName}-${timestamp}.tar.gz`;
    const archivePath = path.join(targetDir, archiveFilename);

    // Create the extracted directory path
    const extractedPath = path.join(targetDir, `${repoName}-${timestamp}`);

    serverLogger.info(`Creating archive from local repo: ${resolvedPath}`);
    serverLogger.info(`Archive will be saved to: ${archivePath}`);

    // Use git archive to create a tarball of the repo
    // This excludes .git directory and respects .gitattributes export-ignore
    const archiveCommand = `git archive --format=tar.gz --output="${archivePath}" ${branch}`;

    try {
      await execAsync(archiveCommand, {
        cwd: resolvedPath,
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer for large repos
      });
    } catch (error) {
      serverLogger.error("Git archive command failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create archive",
      };
    }

    // Verify archive was created
    try {
      const stat = await fs.stat(archivePath);
      if (!stat.isFile()) {
        return {
          success: false,
          error: "Archive file was not created",
        };
      }
      serverLogger.info(`Archive created successfully: ${stat.size} bytes`);
    } catch (error) {
      return {
        success: false,
        error: "Archive file does not exist after creation",
      };
    }

    // Extract the archive to the target directory
    await fs.mkdir(extractedPath, { recursive: true });

    const extractCommand = `tar -xzf "${archivePath}" -C "${extractedPath}"`;

    try {
      await execAsync(extractCommand, {
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      });
      serverLogger.info(`Archive extracted successfully to: ${extractedPath}`);
    } catch (error) {
      serverLogger.error("Failed to extract archive:", error);
      // Clean up the archive file
      try {
        await fs.unlink(archivePath);
      } catch {
        // Ignore cleanup errors
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to extract archive",
      };
    }

    // Optionally clean up the archive file after extraction
    try {
      await fs.unlink(archivePath);
      serverLogger.info("Archive file cleaned up");
    } catch (error) {
      serverLogger.warn("Failed to clean up archive file:", error);
      // Not a critical error, continue
    }

    return {
      success: true,
      archivePath,
      extractedPath,
    };
  } catch (error) {
    serverLogger.error("Error archiving local repo:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Cleans up an extracted local repo directory
 *
 * @param extractedPath - Path to the extracted repo directory
 */
export async function cleanupExtractedRepo(extractedPath: string): Promise<void> {
  try {
    await fs.rm(extractedPath, { recursive: true, force: true });
    serverLogger.info(`Cleaned up extracted repo: ${extractedPath}`);
  } catch (error) {
    serverLogger.warn(`Failed to clean up extracted repo: ${extractedPath}`, error);
  }
}
