/**
 * Script to apply editor settings (settings.json, keybindings, snippets, extensions)
 * to the cloud workspace. Runs inside the Morph instance via Bun.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface AuthFile {
  destinationPath: string;
  contentBase64: string;
  mode?: string;
}

const authFilesJson = process.env.CMUX_AUTH_FILES;
if (!authFilesJson) {
  console.log("No CMUX_AUTH_FILES provided, skipping editor settings");
  process.exit(0);
}

let authFiles: AuthFile[];
try {
  authFiles = JSON.parse(authFilesJson) as AuthFile[];
} catch (error) {
  console.error("Failed to parse CMUX_AUTH_FILES:", error);
  process.exit(1);
}

console.log(`Applying ${authFiles.length} editor setting files...`);

for (const authFile of authFiles) {
  try {
    // Create parent directory if it doesn't exist
    const dir = dirname(authFile.destinationPath);
    mkdirSync(dir, { recursive: true, mode: 0o755 });

    // Decode and write the file
    const content = Buffer.from(authFile.contentBase64, "base64");
    const mode = authFile.mode ? parseInt(authFile.mode, 8) : 0o644;

    writeFileSync(authFile.destinationPath, content, { mode });

    console.log(`✓ Wrote ${authFile.destinationPath} (${content.length} bytes)`);
  } catch (error) {
    console.error(`Failed to write ${authFile.destinationPath}:`, error);
    // Continue with other files rather than failing completely
  }
}

console.log("Editor settings applied successfully");
