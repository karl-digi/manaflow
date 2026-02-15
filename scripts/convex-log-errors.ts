import { Command } from "commander";
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// ============================================================================
// Table Record Types (from schema.ts)
// ============================================================================

interface TaskRecord {
  _id: string;
  _creationTime: number;
  text: string;
  isCompleted: boolean;
  isArchived?: boolean;
  crownEvaluationStatus?: "pending" | "in_progress" | "succeeded" | "error";
  selectedTaskRunId?: string;
  teamId: string;
  userId: string;
  createdAt?: number;
  updatedAt?: number;
}

interface TaskRunRecord {
  _id: string;
  _creationTime: number;
  taskId: string;
  status?: string;
  isArchived?: boolean;
  teamId: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  vscode?: {
    containerName?: string;
    status?: string;
  };
}

interface SandboxInstanceActivityRecord {
  _id: string;
  instanceId: string;
  provider: string;
  teamId?: string;
  userId?: string;
  createdAt?: number;
  lastPausedAt?: number;
  lastResumedAt?: number;
  stoppedAt?: number;
}

interface AutomatedCodeReviewJobRecord {
  _id: string;
  _creationTime: number;
  state: string;
  sandboxInstanceId?: string;
  repoFullName: string;
  prNumber?: number;
  teamId?: string;
  createdAt: number;
  updatedAt: number;
}

interface PreviewRunRecord {
  _id: string;
  _creationTime: number;
  status: string;
  teamId: string;
  repoFullName: string;
  prNumber: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Health Check Types
// ============================================================================

interface TableHealthSummary {
  tableName: string;
  totalCount: number;
  statusDistribution: Record<string, number>;
  stuckRecords: number;
  healthStatus: "healthy" | "warning" | "critical";
}

interface DbHealthReport {
  timestamp: Date;
  tables: TableHealthSummary[];
  overallStatus: "healthy" | "warning" | "critical";
}

type DataIssueType =
  | "stuck_task_run"
  | "stuck_crown_evaluation"
  | "stuck_code_review_job"
  | "stuck_preview_run"
  | "missing_selected_run";

interface DataIssue {
  type: DataIssueType;
  severity: "warning" | "error";
  tableName: string;
  recordId: string;
  description: string;
  stuckDuration?: number;
  suggestions: string[];
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
  // New DB debugging options
  dbHealth: boolean;
  dataIssues: boolean;
  table?: string;
  status?: string;
  teamId?: string;
  limit: number;
  since?: string;
  watch: boolean;
  notify: boolean;
  envFile: string;
  // Fix stuck options
  fixStuck: boolean;
  dryRun: boolean;
}

// Thresholds for stuck detection (in milliseconds)
const STUCK_TASK_RUN_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const STUCK_CROWN_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const STUCK_CODE_REVIEW_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const STUCK_PREVIEW_RUN_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

const program = new Command()
  .name("convex-log-errors")
  .description(
    "Detect and analyze Convex errors and database health issues."
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
  .option("--json", "Output as JSON", false)
  // New DB debugging options
  .option("--db-health", "Show database health summary for key tables", false)
  .option("--data-issues", "Detect stuck/orphaned records across all tables", false)
  .option("--table <name>", "Query specific table (tasks, taskRuns, etc.)")
  .option("--status <status>", "Filter by status field (use with --table)")
  .option("--team-id <teamId>", "Filter by teamId")
  .option("--limit <n>", "Limit query results", "20")
  .option("--since <duration>", "Filter by time (e.g., 1h, 24h, 7d)")
  .option("--watch", "Watch log file in real-time", false)
  .option("--notify", "Enable system notifications (use with --watch)", false)
  .option("--env-file <path>", "Path to env file for CONVEX_DEPLOY_KEY", ".env")
  // Fix stuck options
  .option("--fix-stuck", "Mark stuck taskRuns as failed", false)
  .option("--dry-run", "Show what would be fixed without making changes", false);

// ============================================================================
// Database Query Helpers
// ============================================================================

/**
 * Fetch data from a Convex table using CLI
 */
function fetchConvexTable<T>(
  tableName: string,
  options: { limit?: number; envFile?: string } = {}
): T[] {
  const { limit = 10000, envFile = ".env" } = options;
  const tmpFile = join(tmpdir(), `convex-${tableName}-${Date.now()}.json`);

  try {
    // Load env file if it exists
    let env = { ...process.env };
    if (existsSync(envFile)) {
      const envContent = readFileSync(envFile, "utf-8");
      for (const line of envContent.split("\n")) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          // Remove surrounding quotes if present
          env[key.trim()] = value.trim().replace(/^["']|["']$/g, "");
        }
      }
    }

    execSync(
      `bunx convex data ${tableName} --format json --limit ${limit} > "${tmpFile}" 2>/dev/null`,
      {
        encoding: "utf-8",
        maxBuffer: 200 * 1024 * 1024,
        shell: "/bin/bash",
        timeout: 120000,
        cwd: "packages/convex",
        env,
      }
    );

    const content = readFileSync(tmpFile, "utf-8").trim();
    if (!content || content === "There are no documents in this table.") {
      return [];
    }
    return JSON.parse(content) as T[];
  } catch (error) {
    console.error(
      `Failed to fetch ${tableName}:`,
      error instanceof Error ? error.message : String(error)
    );
    return [];
  } finally {
    if (existsSync(tmpFile)) {
      try {
        unlinkSync(tmpFile);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * Parse duration string (e.g., "1h", "24h", "7d") to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like 1h, 24h, 7d`);
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// ============================================================================
// Database Health Check Functions
// ============================================================================

/**
 * Get health summary for key tables
 */
function getDbHealth(options: Options): DbHealthReport {
  const tables: TableHealthSummary[] = [];
  const now = Date.now();

  // Check tasks table
  const tasks = fetchConvexTable<TaskRecord>("tasks", { envFile: options.envFile });
  const taskStatusDist: Record<string, number> = {};
  let taskStuck = 0;
  for (const task of tasks) {
    const status = task.crownEvaluationStatus ?? "none";
    taskStatusDist[status] = (taskStatusDist[status] ?? 0) + 1;
    if (
      (status === "pending" || status === "in_progress") &&
      now - (task.updatedAt ?? task._creationTime) > STUCK_CROWN_THRESHOLD_MS
    ) {
      taskStuck++;
    }
  }
  tables.push({
    tableName: "tasks",
    totalCount: tasks.length,
    statusDistribution: taskStatusDist,
    stuckRecords: taskStuck,
    healthStatus: taskStuck > 5 ? "critical" : taskStuck > 0 ? "warning" : "healthy",
  });

  // Check taskRuns table
  const taskRuns = fetchConvexTable<TaskRunRecord>("taskRuns", { envFile: options.envFile });
  const runStatusDist: Record<string, number> = {};
  let runStuck = 0;
  for (const run of taskRuns) {
    const status = run.status ?? "unknown";
    runStatusDist[status] = (runStatusDist[status] ?? 0) + 1;
    if (
      (status === "pending" || status === "running") &&
      now - run.updatedAt > STUCK_TASK_RUN_THRESHOLD_MS
    ) {
      runStuck++;
    }
  }
  tables.push({
    tableName: "taskRuns",
    totalCount: taskRuns.length,
    statusDistribution: runStatusDist,
    stuckRecords: runStuck,
    healthStatus: runStuck > 5 ? "critical" : runStuck > 0 ? "warning" : "healthy",
  });

  // Check automatedCodeReviewJobs
  const codeReviewJobs = fetchConvexTable<AutomatedCodeReviewJobRecord>(
    "automatedCodeReviewJobs",
    { envFile: options.envFile }
  );
  const reviewStatusDist: Record<string, number> = {};
  let reviewStuck = 0;
  for (const job of codeReviewJobs) {
    reviewStatusDist[job.state] = (reviewStatusDist[job.state] ?? 0) + 1;
    if (
      (job.state === "pending" || job.state === "running") &&
      now - job.updatedAt > STUCK_CODE_REVIEW_THRESHOLD_MS
    ) {
      reviewStuck++;
    }
  }
  tables.push({
    tableName: "automatedCodeReviewJobs",
    totalCount: codeReviewJobs.length,
    statusDistribution: reviewStatusDist,
    stuckRecords: reviewStuck,
    healthStatus: reviewStuck > 3 ? "critical" : reviewStuck > 0 ? "warning" : "healthy",
  });

  // Check previewRuns
  const previewRuns = fetchConvexTable<PreviewRunRecord>("previewRuns", { envFile: options.envFile });
  const previewStatusDist: Record<string, number> = {};
  let previewStuck = 0;
  for (const run of previewRuns) {
    previewStatusDist[run.status] = (previewStatusDist[run.status] ?? 0) + 1;
    if (
      (run.status === "pending" || run.status === "running") &&
      now - run.updatedAt > STUCK_PREVIEW_RUN_THRESHOLD_MS
    ) {
      previewStuck++;
    }
  }
  tables.push({
    tableName: "previewRuns",
    totalCount: previewRuns.length,
    statusDistribution: previewStatusDist,
    stuckRecords: previewStuck,
    healthStatus: previewStuck > 3 ? "critical" : previewStuck > 0 ? "warning" : "healthy",
  });

  // Check sandboxInstanceActivity
  const sandboxActivity = fetchConvexTable<SandboxInstanceActivityRecord>(
    "sandboxInstanceActivity",
    { envFile: options.envFile }
  );
  const sandboxStatusDist: Record<string, number> = { active: 0, stopped: 0 };
  for (const activity of sandboxActivity) {
    if (activity.stoppedAt) {
      sandboxStatusDist.stopped++;
    } else {
      sandboxStatusDist.active++;
    }
  }
  tables.push({
    tableName: "sandboxInstanceActivity",
    totalCount: sandboxActivity.length,
    statusDistribution: sandboxStatusDist,
    stuckRecords: 0,
    healthStatus: "healthy",
  });

  // Determine overall status
  const criticalCount = tables.filter((t) => t.healthStatus === "critical").length;
  const warningCount = tables.filter((t) => t.healthStatus === "warning").length;
  const overallStatus: "healthy" | "warning" | "critical" =
    criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "healthy";

  return {
    timestamp: new Date(),
    tables,
    overallStatus,
  };
}

/**
 * Format DB health report for human-readable output
 */
function formatDbHealthReport(report: DbHealthReport): string {
  const lines: string[] = [];

  lines.push("Database Health Report");
  lines.push("======================");
  lines.push(`Generated: ${report.timestamp.toLocaleString()}`);
  lines.push(`Overall Status: ${report.overallStatus.toUpperCase()}`);
  lines.push("");

  for (const table of report.tables) {
    const statusIcon =
      table.healthStatus === "critical"
        ? "[!]"
        : table.healthStatus === "warning"
          ? "[?]"
          : "[ok]";
    lines.push(`${statusIcon} ${table.tableName} (${table.totalCount} records)`);

    // Show status distribution
    const distParts = Object.entries(table.statusDistribution)
      .map(([status, count]) => `${status}: ${count}`)
      .join(", ");
    lines.push(`    Distribution: ${distParts}`);

    if (table.stuckRecords > 0) {
      lines.push(`    Stuck records: ${table.stuckRecords}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Data Issue Detection Functions
// ============================================================================

/**
 * Detect all data issues across tables
 */
function detectDataIssues(options: Options): DataIssue[] {
  const issues: DataIssue[] = [];
  const now = Date.now();

  // Detect stuck taskRuns
  const taskRuns = fetchConvexTable<TaskRunRecord>("taskRuns", { envFile: options.envFile });
  for (const run of taskRuns) {
    const status = run.status ?? "unknown";
    if (
      (status === "pending" || status === "running") &&
      now - run.updatedAt > STUCK_TASK_RUN_THRESHOLD_MS
    ) {
      issues.push({
        type: "stuck_task_run",
        severity: "error",
        tableName: "taskRuns",
        recordId: run._id,
        description: `TaskRun stuck in "${status}" for ${formatDuration(now - run.updatedAt)}`,
        stuckDuration: now - run.updatedAt,
        suggestions: [
          "Check sandbox instance status",
          "Review convex-dev.log for errors",
          "Consider marking as failed manually",
        ],
      });
    }
  }

  // Detect stuck crown evaluations
  const tasks = fetchConvexTable<TaskRecord>("tasks", { envFile: options.envFile });
  for (const task of tasks) {
    const status = task.crownEvaluationStatus;
    if (
      (status === "pending" || status === "in_progress") &&
      now - (task.updatedAt ?? task._creationTime) > STUCK_CROWN_THRESHOLD_MS
    ) {
      issues.push({
        type: "stuck_crown_evaluation",
        severity: "warning",
        tableName: "tasks",
        recordId: task._id,
        description: `Crown evaluation stuck in "${status}" for ${formatDuration(now - (task.updatedAt ?? task._creationTime))}`,
        stuckDuration: now - (task.updatedAt ?? task._creationTime),
        suggestions: [
          "Crown cron will auto-recover within 1 hour",
          "Check crown_http.ts logs for API errors",
          "Verify Anthropic API connectivity",
        ],
      });
    }
  }

  // Detect stuck code review jobs
  const codeReviewJobs = fetchConvexTable<AutomatedCodeReviewJobRecord>(
    "automatedCodeReviewJobs",
    { envFile: options.envFile }
  );
  for (const job of codeReviewJobs) {
    if (
      (job.state === "pending" || job.state === "running") &&
      now - job.updatedAt > STUCK_CODE_REVIEW_THRESHOLD_MS
    ) {
      issues.push({
        type: "stuck_code_review_job",
        severity: "warning",
        tableName: "automatedCodeReviewJobs",
        recordId: job._id,
        description: `Code review job stuck in "${job.state}" for ${formatDuration(now - job.updatedAt)}`,
        stuckDuration: now - job.updatedAt,
        suggestions: [
          `Repo: ${job.repoFullName}`,
          "Check sandbox instance if sandboxInstanceId present",
          "Review automatedCodeReview.ts logs",
        ],
      });
    }
  }

  // Detect stuck preview runs
  const previewRuns = fetchConvexTable<PreviewRunRecord>("previewRuns", { envFile: options.envFile });
  for (const run of previewRuns) {
    if (
      (run.status === "pending" || run.status === "running") &&
      now - run.updatedAt > STUCK_PREVIEW_RUN_THRESHOLD_MS
    ) {
      issues.push({
        type: "stuck_preview_run",
        severity: "warning",
        tableName: "previewRuns",
        recordId: run._id,
        description: `Preview run stuck in "${run.status}" for ${formatDuration(now - run.updatedAt)}`,
        stuckDuration: now - run.updatedAt,
        suggestions: [
          `Repo: ${run.repoFullName} PR#${run.prNumber}`,
          "Check previewRuns.ts logs",
        ],
      });
    }
  }

  // Detect tasks missing selectedTaskRunId
  const taskRunsByTask = new Map<string, TaskRunRecord[]>();
  for (const run of taskRuns) {
    const existing = taskRunsByTask.get(run.taskId) ?? [];
    existing.push(run);
    taskRunsByTask.set(run.taskId, existing);
  }
  for (const task of tasks) {
    if (task.isCompleted && !task.selectedTaskRunId && !task.isArchived) {
      const runs = taskRunsByTask.get(task._id) ?? [];
      const eligibleRuns = runs.filter(
        (r) => r.status === "completed" && !r.isArchived
      );
      if (eligibleRuns.length > 0) {
        issues.push({
          type: "missing_selected_run",
          severity: "warning",
          tableName: "tasks",
          recordId: task._id,
          description: `Completed task has no selectedTaskRunId but has ${eligibleRuns.length} eligible runs`,
          suggestions: [
            "Run updateSelectedTaskRunForTask internal mutation",
            "Check if crown evaluation completed properly",
          ],
        });
      }
    }
  }

  return issues;
}

/**
 * Format data issues for human-readable output
 */
function formatDataIssues(issues: DataIssue[]): string {
  const lines: string[] = [];

  lines.push("Data Issues Report");
  lines.push("==================");
  lines.push("");

  if (issues.length === 0) {
    lines.push("No data issues found.");
    return lines.join("\n");
  }

  // Group by type
  const byType = new Map<DataIssueType, DataIssue[]>();
  for (const issue of issues) {
    const existing = byType.get(issue.type) ?? [];
    existing.push(issue);
    byType.set(issue.type, existing);
  }

  for (const [type, typeIssues] of byType) {
    const icon = typeIssues[0].severity === "error" ? "[ERROR]" : "[WARN]";
    lines.push(`${icon} ${type} (${typeIssues.length} issues)`);
    lines.push("-".repeat(50));

    for (const issue of typeIssues.slice(0, 10)) {
      lines.push(`  ID: ${issue.recordId}`);
      lines.push(`  ${issue.description}`);
      for (const suggestion of issue.suggestions) {
        lines.push(`    - ${suggestion}`);
      }
      lines.push("");
    }

    if (typeIssues.length > 10) {
      lines.push(`  ... and ${typeIssues.length - 10} more`);
      lines.push("");
    }
  }

  lines.push(`Total: ${issues.length} issues found`);
  return lines.join("\n");
}

// ============================================================================
// Table Query Functions
// ============================================================================

/**
 * Query a specific table with filters
 */
function queryTable(options: Options): void {
  if (!options.table) {
    console.error("Error: --table option is required");
    process.exit(1);
  }

  const records = fetchConvexTable<Record<string, unknown>>(options.table, {
    limit: options.limit,
    envFile: options.envFile,
  });

  let filtered = records;

  // Filter by status
  if (options.status) {
    filtered = filtered.filter((r) => {
      const status = r.status ?? r.state ?? r.crownEvaluationStatus;
      return status === options.status;
    });
  }

  // Filter by teamId
  if (options.teamId) {
    filtered = filtered.filter((r) => r.teamId === options.teamId);
  }

  // Filter by time
  if (options.since) {
    const sinceMs = parseDuration(options.since);
    const cutoff = Date.now() - sinceMs;
    filtered = filtered.filter((r) => {
      const timestamp = (r.createdAt as number) ?? (r._creationTime as number);
      return timestamp >= cutoff;
    });
  }

  // Apply limit
  filtered = filtered.slice(0, options.limit);

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    console.log(`Table: ${options.table}`);
    console.log(`Records: ${filtered.length} (of ${records.length} total)`);
    console.log("=".repeat(50));
    console.log("");

    for (const record of filtered) {
      console.log(`ID: ${record._id}`);
      const displayFields = ["status", "state", "crownEvaluationStatus", "teamId", "createdAt", "updatedAt"];
      for (const field of displayFields) {
        if (record[field] !== undefined) {
          let value = record[field];
          if (typeof value === "number" && field.includes("At")) {
            value = new Date(value).toLocaleString();
          }
          console.log(`  ${field}: ${value}`);
        }
      }
      console.log("");
    }
  }
}

// ============================================================================
// Watch Mode
// ============================================================================

/**
 * Watch log file in real-time
 */
async function watchLogFile(options: Options): Promise<void> {
  const filePath = options.file;
  const file = Bun.file(filePath);
  let lastSize = (await file.exists()) ? file.size : 0;

  console.log(`Watching ${filePath} for new errors...`);
  console.log("Press Ctrl+C to stop\n");

  const checkInterval = setInterval(async () => {
    if (!(await file.exists())) return;

    const currentSize = file.size;
    if (currentSize > lastSize) {
      const content = await file.slice(lastSize, currentSize).text();
      const lines = content.split("\n");

      // Check for error patterns
      const headerRegex =
        /^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM)) \[CONVEX ([QMAH])\(([^)]+)\)\] Uncaught Error: (.+)$/;

      for (const line of lines) {
        const match = line.match(headerRegex);
        if (match) {
          const [, timestamp, typeChar, functionName, errorMessage] = match;
          const typeMap: Record<string, string> = {
            Q: "Query",
            M: "Mutation",
            A: "Action",
            H: "HttpAction",
          };

          console.log(`[${timestamp}] ${typeMap[typeChar] ?? "Unknown"}: ${functionName}`);
          console.log(`  Error: ${errorMessage}`);
          console.log("");

          // System notification on macOS
          if (options.notify) {
            try {
              execSync(
                `osascript -e 'display notification "${errorMessage.replace(/"/g, '\\"')}" with title "Convex Error: ${functionName}"'`,
                { stdio: "ignore" }
              );
            } catch {
              /* ignore notification errors */
            }
          }
        }
      }

      lastSize = currentSize;
    }
  }, 1000);

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(checkInterval);
    console.log("\nStopped watching.");
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {});
}

// ============================================================================
// Fix Stuck TaskRuns
// ============================================================================

const FIX_STUCK_LOG_PATH = "logs/convex-fix-stuck.log";

/**
 * Append to fix-stuck log file
 */
function logFixAction(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  // Ensure logs directory exists
  const logsDir = "logs";
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  appendFileSync(FIX_STUCK_LOG_PATH, logLine);
}

/**
 * Fix stuck taskRuns by marking them as failed
 */
async function fixStuckTaskRuns(options: Options): Promise<void> {
  console.log("Scanning for stuck taskRuns...\n");

  // Get stuck taskRuns using existing detection
  const issues = detectDataIssues(options);
  const stuckRuns = issues.filter((i) => i.type === "stuck_task_run");

  if (stuckRuns.length === 0) {
    console.log("No stuck taskRuns found.");
    return;
  }

  console.log(`Found ${stuckRuns.length} stuck taskRuns:\n`);

  for (const issue of stuckRuns) {
    console.log(`  ${issue.recordId}`);
    console.log(`    ${issue.description}`);
  }
  console.log("");

  if (options.dryRun) {
    console.log("[DRY RUN] Would mark these taskRuns as failed.");
    console.log("Run without --dry-run to actually fix them.");
    return;
  }

  // Load env for Convex CLI
  let env = { ...process.env };
  if (existsSync(options.envFile)) {
    const envContent = readFileSync(options.envFile, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        env[key.trim()] = value.trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  // Log start
  logFixAction(`FIX-STUCK started (${stuckRuns.length} stuck taskRuns found)`);
  console.log("Fixing stuck taskRuns...\n");
  console.log(`Logging to: ${FIX_STUCK_LOG_PATH}\n`);

  let fixed = 0;
  let failed = 0;

  for (const issue of stuckRuns) {
    const runId = issue.recordId;
    try {
      // Call internal mutation to mark as failed
      execSync(
        `bunx convex run taskRuns:updateStatus '{"id":"${runId}","status":"failed"}' 2>/dev/null`,
        {
          encoding: "utf-8",
          cwd: "packages/convex",
          env,
          timeout: 30000,
        }
      );
      const logMsg = `[OK] ${runId} marked as failed (${issue.description})`;
      console.log(`  ${logMsg}`);
      logFixAction(logMsg);
      fixed++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const logMsg = `[FAIL] ${runId}: ${errorMsg}`;
      console.error(`  ${logMsg}`);
      logFixAction(logMsg);
      failed++;
    }
  }

  // Log completion
  const summary = `FIX-STUCK completed: ${fixed} fixed, ${failed} failed`;
  logFixAction(summary);

  console.log("");
  console.log(`Done: ${fixed} fixed, ${failed} failed`);
  console.log(`Log saved to: ${FIX_STUCK_LOG_PATH}`);
}

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
    // New DB debugging options
    dbHealth: opts.dbHealth === true,
    dataIssues: opts.dataIssues === true,
    table: opts.table as string | undefined,
    status: opts.status as string | undefined,
    teamId: opts.teamId as string | undefined,
    limit: parseInt(opts.limit as string, 10) || 20,
    since: opts.since as string | undefined,
    watch: opts.watch === true,
    notify: opts.notify === true,
    envFile: opts.envFile as string,
    // Fix stuck options
    fixStuck: opts.fixStuck === true,
    dryRun: opts.dryRun === true,
  };

  // Handle fix-stuck mode
  if (options.fixStuck) {
    await fixStuckTaskRuns(options);
    return;
  }

  // Handle new DB debugging modes
  if (options.dbHealth) {
    const report = getDbHealth(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDbHealthReport(report));
    }
    return;
  }

  if (options.dataIssues) {
    const issues = detectDataIssues(options);
    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      console.log(formatDataIssues(issues));
    }
    return;
  }

  if (options.table) {
    queryTable(options);
    return;
  }

  if (options.watch) {
    await watchLogFile(options);
    return;
  }

  // Original log error detection mode
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
