import { Command } from "commander";

/**
 * Convex Log Entry from `npx convex logs --jsonl`
 */
interface ConvexLogEntry {
  kind: string;
  udfType: "Query" | "Mutation" | "Action" | "HttpAction";
  identifier: string;
  timestamp: number;
  success: unknown | null;
  error: string | null;
  logLines: Array<{ messages: string[]; level: string; timestamp: number }>;
  executionTime: number;
  requestId: string;
}

/**
 * Parsed error from either source
 */
interface ConvexError {
  timestamp: Date;
  type: string;
  functionName: string;
  errorMessage: string;
  source: "file" | "cloud";
  stackLocation?: string;
}

/**
 * Aggregated error group
 */
interface AggregatedError {
  errorMessage: string;
  functionName: string;
  type: string;
  count: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
  source: "file" | "cloud";
  stackLocation?: string;
}

interface Options {
  cloudOnly: boolean;
  localOnly: boolean;
  file: string;
  history: number;
  filter?: string;
  aggregate: boolean;
  json: boolean;
}

const program = new Command()
  .name("convex-log-errors")
  .description(
    "Detect and analyze Convex errors from local dev log and cloud production."
  )
  .option("--cloud-only", "Show errors from cloud production only", false)
  .option("--local-only", "Show errors from local dev log only", false)
  .option(
    "--file <path>",
    "Path to local Convex dev log file",
    "logs/convex-dev.log"
  )
  .option(
    "--history <count>",
    "Number of log entries to fetch from cloud",
    "100"
  )
  .option("--filter <pattern>", "Filter by function name pattern")
  .option(
    "--no-aggregate",
    "Show all errors without aggregation (default: aggregate)"
  )
  .option("--json", "Output as JSON", false);

/**
 * Parse local Convex dev log file for errors
 *
 * Format:
 * ```
 * 2/1/2026, 1:18:09 PM [CONVEX Q(github:listProviderConnections)] Uncaught Error: Forbidden: Not a member of this team
 *     at getTeamId (../../_shared/team.ts:53:9)
 *     at async handler (../convex/github.ts:217:17)
 * ```
 */
async function parseLocalLogFile(filePath: string): Promise<ConvexError[]> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return [];
  }

  const content = await file.text();
  const lines = content.split("\n");
  const errors: ConvexError[] = [];

  // Regex to match the error header line
  // Format: M/D/YYYY, H:MM:SS AM/PM [CONVEX X(function:name)] Uncaught Error: message
  const headerRegex =
    /^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM)) \[CONVEX ([QMAH])\(([^)]+)\)\] Uncaught Error: (.+)$/;

  // Regex to match stack trace lines
  const stackRegex = /^\s+at\s+(?:async\s+)?(\w+)\s+\(([^)]+)\)$/;

  let currentError: ConvexError | null = null;
  let stackLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(headerRegex);

    if (headerMatch) {
      // Save previous error if exists
      if (currentError) {
        if (stackLines.length > 0) {
          currentError.stackLocation = stackLines.join(" -> ");
        }
        errors.push(currentError);
      }

      const [, timestampStr, typeChar, functionName, errorMessage] =
        headerMatch;

      const typeMap: Record<string, string> = {
        Q: "Query",
        M: "Mutation",
        A: "Action",
        H: "HttpAction",
      };

      currentError = {
        timestamp: parseConvexTimestamp(timestampStr),
        type: typeMap[typeChar] ?? "Unknown",
        functionName,
        errorMessage,
        source: "file",
      };
      stackLines = [];
    } else if (currentError) {
      const stackMatch = line.match(stackRegex);
      if (stackMatch) {
        const [, , location] = stackMatch;
        // Normalize path: remove ../ prefixes
        const normalizedLocation = location.replace(/\.\.\/+/g, "");
        stackLines.push(normalizedLocation);
      }
    }
  }

  // Don't forget the last error
  if (currentError) {
    if (stackLines.length > 0) {
      currentError.stackLocation = stackLines.join(" -> ");
    }
    errors.push(currentError);
  }

  return errors;
}

/**
 * Parse timestamp from Convex dev log format
 * Format: M/D/YYYY, H:MM:SS AM/PM
 */
function parseConvexTimestamp(timestampStr: string): Date {
  // Parse format: "2/1/2026, 1:18:09 PM"
  const [datePart, timePart] = timestampStr.split(", ");
  const [month, day, year] = datePart.split("/").map(Number);
  const [time, period] = timePart.split(" ");
  const [hours, minutes, seconds] = time.split(":").map(Number);

  let hour24 = hours;
  if (period === "PM" && hours !== 12) {
    hour24 = hours + 12;
  } else if (period === "AM" && hours === 12) {
    hour24 = 0;
  }

  return new Date(year, month - 1, day, hour24, minutes, seconds);
}

/**
 * Fetch errors from Convex Cloud using CLI
 *
 * Note: `convex logs` runs in watch mode, so we need to:
 * 1. Wait for the initial history dump
 * 2. Kill the process after we have enough entries or a timeout
 */
async function fetchCloudLogs(history: number): Promise<ConvexError[]> {
  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey) {
    console.error(
      "Warning: CONVEX_DEPLOY_KEY not set, skipping cloud log fetch"
    );
    return [];
  }

  try {
    const proc = Bun.spawn(
      ["bunx", "convex", "logs", "--jsonl", "--history", String(history)],
      {
        cwd: "packages/convex",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
      }
    );

    const errors: ConvexError[] = [];
    let linesReceived = 0;
    let buffer = "";

    // Set up a timeout to kill the process after we get enough data
    // The convex logs command streams indefinitely, so we kill it after
    // we receive enough lines or after a reasonable timeout
    const TIMEOUT_MS = 10000; // 10 seconds max
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, TIMEOUT_MS);

    // Read stdout and parse JSONL as it comes in
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("{")) continue;
          linesReceived++;

          try {
            const entry = JSON.parse(line) as ConvexLogEntry;
            if (entry.error !== null && entry.kind === "Completion") {
              errors.push({
                timestamp: new Date(entry.timestamp * 1000),
                type: entry.udfType,
                functionName: entry.identifier,
                errorMessage: entry.error,
                source: "cloud",
              });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }

        // Once we have enough lines from the history dump, we can stop
        // The CLI outputs history first, then switches to watch mode
        if (linesReceived >= history) {
          proc.kill();
          break;
        }
      }
    } finally {
      clearTimeout(timeoutId);
      reader.releaseLock();
    }

    return errors;
  } catch (error) {
    console.error(
      `Warning: Failed to fetch cloud logs: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Aggregate errors by error message and function name
 */
function aggregateErrors(errors: ConvexError[]): AggregatedError[] {
  const grouped = new Map<string, AggregatedError>();

  for (const error of errors) {
    // Create a key based on source, error message, and function name
    const key = `${error.source}:${error.functionName}:${error.errorMessage}`;

    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
      if (error.timestamp < existing.firstOccurrence) {
        existing.firstOccurrence = error.timestamp;
      }
      if (error.timestamp > existing.lastOccurrence) {
        existing.lastOccurrence = error.timestamp;
      }
    } else {
      grouped.set(key, {
        errorMessage: error.errorMessage,
        functionName: error.functionName,
        type: error.type,
        count: 1,
        firstOccurrence: error.timestamp,
        lastOccurrence: error.timestamp,
        source: error.source,
        stackLocation: error.stackLocation,
      });
    }
  }

  // Sort by count descending, then by last occurrence descending
  return Array.from(grouped.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return b.lastOccurrence.getTime() - a.lastOccurrence.getTime();
  });
}

/**
 * Filter errors by function name pattern
 */
function filterErrors<T extends { functionName: string }>(
  errors: T[],
  pattern: string
): T[] {
  const regex = new RegExp(pattern, "i");
  return errors.filter((error) => regex.test(error.functionName));
}

/**
 * Format time for display
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Format aggregated errors for human-readable output
 */
function formatHumanOutput(
  cloudErrors: AggregatedError[],
  localErrors: AggregatedError[],
  options: Options
): string {
  const lines: string[] = [];

  lines.push("Convex Errors Summary");
  lines.push("=====================");
  lines.push("");

  // Cloud errors section
  if (!options.localOnly) {
    lines.push("=== Cloud Production ===");
    lines.push("");

    if (cloudErrors.length === 0) {
      lines.push("No errors found.");
    } else {
      for (const error of cloudErrors) {
        const occurrenceText =
          error.count === 1 ? "1 occurrence" : `${error.count} occurrences`;
        lines.push(`[${occurrenceText}] ${error.errorMessage}`);
        lines.push(`  Function: ${error.functionName} (${error.type})`);

        if (error.count === 1) {
          lines.push(`  Time: ${formatTime(error.lastOccurrence)}`);
        } else {
          lines.push(
            `  First: ${formatTime(error.firstOccurrence)} | Last: ${formatTime(error.lastOccurrence)}`
          );
        }
        lines.push("");
      }
    }

    const cloudTotal = cloudErrors.reduce((sum, e) => sum + e.count, 0);
    lines.push(`Subtotal: ${cloudTotal} errors (${cloudErrors.length} unique)`);
    lines.push("");
  }

  // Local errors section
  if (!options.cloudOnly) {
    lines.push("=== Local Dev Log ===");
    lines.push("");

    if (localErrors.length === 0) {
      lines.push("No errors found.");
    } else {
      for (const error of localErrors) {
        const occurrenceText =
          error.count === 1 ? "1 occurrence" : `${error.count} occurrences`;
        lines.push(`[${occurrenceText}] ${error.errorMessage}`);
        lines.push(`  Function: ${error.functionName} (${error.type})`);

        if (error.stackLocation) {
          lines.push(`  Location: ${error.stackLocation}`);
        }

        if (error.count === 1) {
          lines.push(`  Time: ${formatTime(error.lastOccurrence)}`);
        } else {
          lines.push(
            `  First: ${formatTime(error.firstOccurrence)} | Last: ${formatTime(error.lastOccurrence)}`
          );
        }
        lines.push("");
      }
    }

    const localTotal = localErrors.reduce((sum, e) => sum + e.count, 0);
    lines.push(`Subtotal: ${localTotal} errors (${localErrors.length} unique)`);
    lines.push("");
  }

  // Summary section (only if both sources)
  if (!options.cloudOnly && !options.localOnly) {
    lines.push("=== Summary ===");
    const cloudTotal = cloudErrors.reduce((sum, e) => sum + e.count, 0);
    const localTotal = localErrors.reduce((sum, e) => sum + e.count, 0);
    const totalErrors = cloudTotal + localTotal;
    const sourceCount =
      (cloudErrors.length > 0 ? 1 : 0) + (localErrors.length > 0 ? 1 : 0);
    lines.push(`Total: ${totalErrors} errors across ${sourceCount} sources`);
  }

  return lines.join("\n");
}

/**
 * Format non-aggregated errors for human-readable output
 */
function formatNonAggregatedOutput(
  cloudErrors: ConvexError[],
  localErrors: ConvexError[],
  options: Options
): string {
  const lines: string[] = [];

  lines.push("Convex Errors (Non-Aggregated)");
  lines.push("==============================");
  lines.push("");

  // Cloud errors section
  if (!options.localOnly) {
    lines.push("=== Cloud Production ===");
    lines.push("");

    if (cloudErrors.length === 0) {
      lines.push("No errors found.");
    } else {
      // Sort by timestamp descending (most recent first)
      const sorted = [...cloudErrors].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      );

      for (const error of sorted) {
        lines.push(`[${formatTime(error.timestamp)}] ${error.errorMessage}`);
        lines.push(`  Function: ${error.functionName} (${error.type})`);
        lines.push("");
      }
    }

    lines.push(`Subtotal: ${cloudErrors.length} errors`);
    lines.push("");
  }

  // Local errors section
  if (!options.cloudOnly) {
    lines.push("=== Local Dev Log ===");
    lines.push("");

    if (localErrors.length === 0) {
      lines.push("No errors found.");
    } else {
      // Sort by timestamp descending (most recent first)
      const sorted = [...localErrors].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      );

      for (const error of sorted) {
        lines.push(`[${formatTime(error.timestamp)}] ${error.errorMessage}`);
        lines.push(`  Function: ${error.functionName} (${error.type})`);
        if (error.stackLocation) {
          lines.push(`  Location: ${error.stackLocation}`);
        }
        lines.push("");
      }
    }

    lines.push(`Subtotal: ${localErrors.length} errors`);
    lines.push("");
  }

  // Summary section (only if both sources)
  if (!options.cloudOnly && !options.localOnly) {
    lines.push("=== Summary ===");
    const totalErrors = cloudErrors.length + localErrors.length;
    const sourceCount =
      (cloudErrors.length > 0 ? 1 : 0) + (localErrors.length > 0 ? 1 : 0);
    lines.push(`Total: ${totalErrors} errors across ${sourceCount} sources`);
  }

  return lines.join("\n");
}

async function main() {
  program.parse();
  const opts = program.opts();

  const options: Options = {
    cloudOnly: opts.cloudOnly === true,
    localOnly: opts.localOnly === true,
    file: opts.file as string,
    history: parseInt(opts.history as string, 10),
    filter: opts.filter as string | undefined,
    aggregate: opts.aggregate !== false, // --no-aggregate sets this to false
    json: opts.json === true,
  };

  // Validate options
  if (options.cloudOnly && options.localOnly) {
    console.error("Error: Cannot use both --cloud-only and --local-only");
    process.exit(1);
  }

  if (isNaN(options.history) || options.history < 1) {
    console.error("Error: --history must be a positive integer");
    process.exit(1);
  }

  // Fetch errors from both sources
  let cloudErrors: ConvexError[] = [];
  let localErrors: ConvexError[] = [];

  if (!options.localOnly) {
    cloudErrors = await fetchCloudLogs(options.history);
  }

  if (!options.cloudOnly) {
    localErrors = await parseLocalLogFile(options.file);
  }

  // Apply filter if specified
  if (options.filter) {
    cloudErrors = filterErrors(cloudErrors, options.filter);
    localErrors = filterErrors(localErrors, options.filter);
  }

  // Output results
  if (options.json) {
    if (options.aggregate) {
      const aggregatedCloud = aggregateErrors(cloudErrors);
      const aggregatedLocal = aggregateErrors(localErrors);
      console.log(
        JSON.stringify(
          {
            cloud: aggregatedCloud,
            local: aggregatedLocal,
            summary: {
              cloudTotal: aggregatedCloud.reduce((sum, e) => sum + e.count, 0),
              cloudUnique: aggregatedCloud.length,
              localTotal: aggregatedLocal.reduce((sum, e) => sum + e.count, 0),
              localUnique: aggregatedLocal.length,
            },
          },
          null,
          2
        )
      );
    } else {
      console.log(
        JSON.stringify(
          {
            cloud: cloudErrors,
            local: localErrors,
            summary: {
              cloudTotal: cloudErrors.length,
              localTotal: localErrors.length,
            },
          },
          null,
          2
        )
      );
    }
  } else {
    if (options.aggregate) {
      const aggregatedCloud = aggregateErrors(cloudErrors);
      const aggregatedLocal = aggregateErrors(localErrors);
      console.log(
        formatHumanOutput(aggregatedCloud, aggregatedLocal, options)
      );
    } else {
      console.log(
        formatNonAggregatedOutput(cloudErrors, localErrors, options)
      );
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
