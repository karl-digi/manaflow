import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(__dirname, "..");

function checkForEnvLeaks(): void {
  console.log("Checking for .env file leaks in the package...\n");

  const filesToCheck = ["dist", "src", "public"];

  const envPatterns = [/\.env$/, /\.env\./, /^env$/];

  const sensitivePatterns = [
    /API_KEY/i,
    /SECRET/i,
    /PRIVATE_KEY/i,
    /DATABASE_URL/i,
    /CONNECTION_STRING/i,
    /DAYTONA_API_KEY/i,
    /MORPH_API_KEY/i,
    /STACK_SERVER_KEY/i,
  ];

  let hasLeaks = false;
  const foundIssues: string[] = [];

  function scanDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relativePath = path.relative(projectRoot, fullPath);

      if (item.isDirectory() && item.name !== "node_modules") {
        scanDirectory(fullPath);
      } else if (item.isFile()) {
        // Check if filename matches env patterns
        const isEnvFile = envPatterns.some((pattern) =>
          pattern.test(item.name)
        );
        if (isEnvFile) {
          hasLeaks = true;
          foundIssues.push(`Found .env file: ${relativePath}`);
        }

        // Check file contents for sensitive patterns
        if (
          (item.name.endsWith(".js") ||
            item.name.endsWith(".ts") ||
            item.name.endsWith(".json")) &&
          !item.name.includes("test-env-leak") &&
          !item.name.includes("check-publish-security")
        ) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            for (const pattern of sensitivePatterns) {
              if (pattern.test(content)) {
                // Check if it's an actual value assignment (not just a variable name)
                const lines = content.split("\n");
                lines.forEach((line, index) => {
                  if (
                    pattern.test(line) &&
                    line.includes("=") &&
                    !line.includes("process.env")
                  ) {
                    const match = line.match(pattern);
                    if (
                      match &&
                      !line.includes("undefined") &&
                      !line.includes("null") &&
                      !line.includes('""') &&
                      !line.includes("''")
                    ) {
                      hasLeaks = true;
                      foundIssues.push(
                        `Potential leak in ${relativePath}:${index + 1} - Found hardcoded sensitive value matching: ${match[0]}`
                      );
                    }
                  }
                });
              }
            }
          } catch (err) {
            // Ignore read errors
          }
        }
      }
    }
  }

  // Scan each directory
  filesToCheck.forEach((dir) => {
    const fullPath = path.join(projectRoot, dir);
    scanDirectory(fullPath);
  });

  // Check if .gitignore properly excludes .env files
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    const hasEnvIgnore =
      gitignoreContent.includes(".env") || gitignoreContent.includes("*.env");
    if (!hasEnvIgnore) {
      foundIssues.push("WARNING: .gitignore does not exclude .env files");
    } else {
      console.log("[ok] .gitignore properly excludes .env files\n");
    }
  }

  // Report results
  if (hasLeaks) {
    console.error("[FAIL] Found potential security leaks:\n");
    foundIssues.forEach((issue) => console.error(`  - ${issue}`));
    process.exit(1);
  } else {
    console.log("[ok] PASSED: No .env file leaks detected");
    console.log("[ok] No hardcoded sensitive values found");
    process.exit(0);
  }
}

checkForEnvLeaks();
