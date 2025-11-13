export type MonacoLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "markdown"
  | "yaml"
  | "plaintext";

export type DiffSample = {
  id: string;
  filePath: string;
  language: MonacoLanguage;
  original: string;
  modified: string;
};

const EXECUTION_PLAN_STAGE_COUNT = 140;

const executionPlanUpdates = new Map<
  number,
  { status: string; durationMs: number; retries: number }
>([
  [0, { status: "queued", durationMs: 45, retries: 1 }],
  [18, { status: "running", durationMs: 240, retries: 0 }],
  [47, { status: "running", durationMs: 420, retries: 2 }],
  [73, { status: "blocked", durationMs: 0, retries: 3 }],
  [96, { status: "queued", durationMs: 195, retries: 1 }],
  [119, { status: "completed", durationMs: 940, retries: 1 }],
  [139, { status: "completed", durationMs: 1230, retries: 2 }],
]);

const executionPlanInsertions = new Map<number, string[]>([
  [
    59,
    [
      '  { id: "stage-060-review", status: "blocked", durationMs: 0, retries: 2 },',
      '  { id: "stage-060-retry", status: "queued", durationMs: 42, retries: 3 },',
    ],
  ],
  [
    104,
    [
      '  { id: "stage-105-diagnostics", status: "running", durationMs: 720, retries: 1 },',
    ],
  ],
]);

function createLongExecutionPlanSample(): DiffSample {
  const padLabel = (value: number) => value.toString().padStart(3, "0");

  const originalParts: string[] = [
    "type ExecutionStage = {",
    "  id: string;",
    '  status: "pending" | "queued" | "running" | "blocked" | "completed";',
    "  durationMs?: number;",
    "};",
    "",
    "export const executionPlan: ExecutionStage[] = [",
  ];

  const modifiedParts: string[] = [
    "type ExecutionStage = {",
    "  id: string;",
    '  status: "pending" | "queued" | "running" | "blocked" | "completed";',
    "  durationMs?: number;",
    "  retries?: number;",
    "};",
    "",
    "export const executionPlan: ExecutionStage[] = [",
  ];

  for (let index = 0; index < EXECUTION_PLAN_STAGE_COUNT; index += 1) {
    const label = padLabel(index + 1);
    const baseDuration = ((index % 9) + 1) * 25;
    const baseLine = `  { id: "stage-${label}", status: "pending", durationMs: ${baseDuration} },`;
    originalParts.push(baseLine);

    const update = executionPlanUpdates.get(index);
    if (update) {
      modifiedParts.push(
        `  { id: "stage-${label}", status: "${update.status}", durationMs: ${update.durationMs}, retries: ${update.retries} },`,
      );
    } else {
      modifiedParts.push(baseLine);
    }

    const insertions = executionPlanInsertions.get(index);
    if (insertions) {
      modifiedParts.push(...insertions);
    }
  }

  modifiedParts.push(
    '  { id: "stage-141", status: "review", durationMs: 210, retries: 1 },',
  );

  originalParts.push("];");
  modifiedParts.push("];");

  originalParts.push(
    "",
    'export function countStages(status: ExecutionStage["status"]) {',
    "  return executionPlan.filter((stage) => stage.status === status).length;",
    "}",
    "",
    "export function describePlan() {",
    '  return executionPlan.map((stage) => stage.id).join(", ");',
    "}",
    "",
    "export function hasBlockingStage() {",
    '  return executionPlan.some((stage) => stage.status === "blocked");',
    "}",
  );

  modifiedParts.push(
    "",
    'export function countStages(status: ExecutionStage["status"]) {',
    "  return executionPlan.reduce((total, stage) =>",
    "    stage.status === status ? total + 1 : total,",
    "  0);",
    "}",
    "",
    "export function describePlan(options: { includeDurations?: boolean } = {}) {",
    "  return executionPlan",
    "    .map((stage) => {",
    "      if (!options.includeDurations) {",
    "        return stage.id;",
    "      }",
    "      const duration = stage.durationMs ?? 0;",
    "      const retries = stage.retries ?? 0;",
    "      return `${stage.id} (${duration}ms, retries=${retries})`;",
    "    })",
    "    .join(",
    ");",
    "}",
    "",
    "export function hasBlockingStage() {",
    "  return executionPlan.some((stage) => {",
    '    if (stage.status === "blocked") {',
    "      return true;",
    "    }",
    "    return (stage.retries ?? 0) > 2;",
    "  });",
    "}",
    "",
    "export function getRetrySummary() {",
    "  return executionPlan",
    "    .filter((stage) => (stage.retries ?? 0) > 0)",
    "    .map((stage) => `${stage.id}:${stage.retries ?? 0}`)",
    "    .join(",
    ");",
    "}",
  );

  return {
    id: "execution-plan",
    filePath: "apps/server/src/plan/execution-plan.ts",
    language: "typescript",
    original: originalParts.join("\n"),
    modified: modifiedParts.join("\n"),
  };
}

const longExecutionPlanSample = createLongExecutionPlanSample();

const baseDebugMonacoDiffSamples: DiffSample[] = [
  longExecutionPlanSample,
  {
    id: "agents-selector",
    filePath: "packages/agents/src/selector.ts",
    language: "typescript",
    original: `export function rankAgents(agents: Array<{ latency: number }>) {
  return [...agents].sort((a, b) => a.latency - b.latency);
}

export function shouldWakeAgent(lastActiveAt: number, thresholdMs: number) {
  return Date.now() - lastActiveAt > thresholdMs;
}
`,
    modified: `export function rankAgents(agents: Array<{ latency: number; priority?: number }>) {
  return [...agents]
    .map((agent) => ({
      ...agent,
      score: (agent.priority ?? 0) * 1000 - agent.latency,
    }))
    .sort((a, b) => b.score - a.score);
}

export function shouldWakeAgent(lastActiveAt: number, thresholdMs: number) {
  const elapsed = Date.now() - lastActiveAt;
  return elapsed >= thresholdMs && thresholdMs > 0;
}
`,
  },
  {
    id: "feature-flags",
    filePath: "apps/server/src/config/feature-flags.ts",
    language: "typescript",
    original: `export type FeatureFlag = {
  name: string;
  enabled: boolean;
};

export const defaultFlags: FeatureFlag[] = [
  { name: "monaco-batch", enabled: false },
  { name: "agent-recording", enabled: false },
];
export function isEnabled(flags: FeatureFlag[], name: string) {
  return flags.some((flag) => flag.name === name && flag.enabled);
}
`,
    modified: `export type FeatureFlag = {
  name: string;
  enabled: boolean;
};

export const defaultFlags: FeatureFlag[] = [
  { name: "monaco-batch", enabled: true },
  { name: "agent-recording", enabled: false },
  { name: "structured-logs", enabled: true },
];

export function isEnabled(flags: FeatureFlag[], name: string) {
  const found = flags.find((flag) => flag.name === name);
  return found?.enabled ?? false;
}
`,
  },
  {
    id: "format-duration",
    filePath: "apps/client/src/utils/format-duration.ts",
    language: "typescript",
    original: `export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds + "s";
}

export function formatLatency(latency: number) {
  return latency.toFixed(0) + "ms";
}
`,
    modified: `export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? minutes + "m " + remainingSeconds + "s"
    : seconds + "s";
}

export function formatLatency(latency: number) {
  return latency < 1
    ? (latency * 1000).toFixed(0) + "us"
    : latency.toFixed(2) + "ms";
}
`,
  },
  {
    id: "task-progress",
    filePath: "apps/client/src/hooks/use-task-progress.ts",
    language: "typescript",
    original: `export function getTaskProgress(task: { completeSteps: number; totalSteps: number }) {
  if (task.totalSteps === 0) {
    return 0;
  }

  return Math.round((task.completeSteps / task.totalSteps) * 100);
}

export function isTaskStale(updatedAt: number, now: number) {
  return now - updatedAt > 30_000;
}
`,
    modified: `export function getTaskProgress(task: { completeSteps: number; totalSteps: number }) {
  if (task.totalSteps === 0) {
    return 0;
  }

  const value = (task.completeSteps / task.totalSteps) * 100;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function isTaskStale(updatedAt: number, now: number) {
  const elapsed = now - updatedAt;
  return elapsed > 30_000 && elapsed > 0;
}
`,
  },
  {
    id: "session-handler",
    filePath: "apps/server/src/routes/session-handler.ts",
    language: "typescript",
    original: `export async function loadSession(id: string) {
  const response = await fetch("/api/sessions/" + id);
  if (!response.ok) {
    throw new Error("Failed to load session");
  }

  return response.json();
}

export async function archiveSession(id: string) {
  const response = await fetch("/api/sessions/" + id + "/archive", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to archive session");
  }
}
`,
    modified: `export async function loadSession(id: string) {
  const response = await fetch("/api/sessions/" + id);
  if (!response.ok) {
    throw new Error("Failed to load session");
  }

  const payload = await response.json();
  return {
    ...payload,
    loadedAt: Date.now(),
  };
}

export async function archiveSession(id: string) {
  const response = await fetch("/api/sessions/" + id + "/archive", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to archive session");
  }

  return { archiveRequestedAt: Date.now() };
}
`,
  },
  {
    id: "shared-logger",
    filePath: "packages/shared/src/logger.ts",
    language: "typescript",
    original: `export function logInfo(message: string) {
  console.info(message);
}

export function logError(message: string, error?: unknown) {
  console.error(message, error);
}
`,
    modified: `export function logInfo(message: string, context: Record<string, unknown> = {}) {
  console.info("[info] " + message, context);
}

export function logError(message: string, error?: unknown) {
  console.error("[error] " + message, error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}
`,
  },
  {
    id: "run-timers",
    filePath: "apps/client/src/store/run-timers.ts",
    language: "typescript",
    original: `export function startTimer(label: string) {
  performance.mark(label + "-start");
}

export function endTimer(label: string) {
  performance.mark(label + "-end");
  performance.measure(label, label + "-start", label + "-end");
}
`,
    modified: `export function startTimer(label: string) {
  performance.mark(label + "-start");
  console.time(label);
}

export function endTimer(label: string) {
  performance.mark(label + "-end");
  performance.measure(label, label + "-start", label + "-end");
  console.timeEnd(label);
}
`,
  },
  {
    id: "workflows-yaml",
    filePath: "apps/server/src/config/workflows.yaml",
    language: "yaml",
    original: `workflows:
  deploy:
    steps:
      - checkout
      - install
      - build
      - smoke
  verify:
    steps:
      - lint
      - typecheck
      - test
      - coverage
  nightly:
    steps:
      - migrate
      - seed
      - e2e
      - report
`,
    modified: `workflows:
  deploy:
    steps:
      - checkout
      - install
      - build
      - package
      - smoke
  verify:
    steps:
      - lint
      - typecheck
      - test
      - coverage
      - mutation
  nightly:
    steps:
      - migrate
      - seed
      - e2e
      - report
      - snapshot
  cleanup:
    steps:
      - prune
      - rotate-logs
`,
  },
  {
    id: "changelog",
    filePath: "apps/client/src/content/changelog.md",
    language: "markdown",
    original: `## v0.13.0

- add multi-agent support
- improve telemetry

## v0.12.5

- add new worker pool
- fix diff layout

## v0.12.0

- bug fixes
- reduce bundle size

## v0.11.0

- initial release
- support debug routes
`,
    modified: `## v0.13.0

- add multi-agent support
- improve telemetry
- new diff viewer sandbox

## v0.12.5

- add new worker pool
- fix diff layout
- experimental timeline

## v0.12.0

- bug fixes
- reduce bundle size
- document retry semantics

## v0.11.0

- initial release
- support debug routes
- added debug tools
`,
  },
  {
    id: "runtime-schema",
    filePath: "packages/runtime/src/schema.json",
    language: "json",
    original: `{
  "version": 1,
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "status", "type": "string" }
  ],
  "indexes": []
}
`,
    modified: `{
  "version": 1,
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "status", "type": "string" },
    { "name": "createdAt", "type": "number" }
  ],
  "indexes": [
    { "name": "by_status", "fields": ["status"] }
  ]
}
`,
  },
];

const DUPLICATION_FACTOR = 10;

const appendSuffixToFilePath = (filePath: string, suffix: string): string => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  const directory = lastSlashIndex >= 0 ? filePath.slice(0, lastSlashIndex + 1) : "";
  const fileName = lastSlashIndex >= 0 ? filePath.slice(lastSlashIndex + 1) : filePath;
  const lastDotIndex = fileName.lastIndexOf(".");

  if (lastDotIndex <= 0) {
    return `${directory}${fileName}${suffix}`;
  }

  const name = fileName.slice(0, lastDotIndex);
  const extension = fileName.slice(lastDotIndex);

  return `${directory}${name}${suffix}${extension}`;
};

const duplicateSample = (sample: DiffSample, copyIndex: number): DiffSample => {
  if (copyIndex === 0) {
    return { ...sample };
  }

  const suffix = `-copy-${String(copyIndex).padStart(2, "0")}`;

  return {
    ...sample,
    id: `${sample.id}${suffix}`,
    filePath: appendSuffixToFilePath(sample.filePath, suffix),
  };
};

export const debugMonacoDiffSamples: DiffSample[] = Array.from(
  { length: DUPLICATION_FACTOR },
  (_, copyIndex) => baseDebugMonacoDiffSamples.map((sample) => duplicateSample(sample, copyIndex)),
).flat();
