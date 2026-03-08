import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sandbox instance lifecycle maintenance (all providers: morph, pve-lxc, docker, daytona)
// Runs daily at 21:00 UTC (5 AM HKT)
crons.daily(
  "pause old sandbox instances",
  { hourUTC: 21, minuteUTC: 0 },
  internal.sandboxInstanceMaintenance.pauseOldSandboxInstances
);

// Stop inactive sandbox instances (paused for >7 days)
// Runs daily at 21:20 UTC (5:20 AM HKT)
crons.daily(
  "stop old sandbox instances",
  { hourUTC: 21, minuteUTC: 20 },
  internal.sandboxInstanceMaintenance.stopOldSandboxInstances
);

// Clean up orphaned containers (exist in provider but not in Convex)
// Runs daily at 21:40 UTC (5:40 AM HKT)
crons.daily(
  "cleanup orphaned containers",
  { hourUTC: 21, minuteUTC: 40 },
  internal.sandboxInstanceMaintenance.cleanupOrphanedContainers
);

// Clean up orphaned PVE templates daily at 22:00 UTC
crons.daily(
  "cleanup orphaned pve templates",
  { hourUTC: 22, minuteUTC: 0 },
  internal.sandboxInstanceMaintenance.cleanupOrphanedPveTemplates
);

// Recover crown evaluations stuck in pending/in_progress state
// Runs every hour to detect evaluations that failed without proper error handling
crons.interval(
  "recover stuck crown evaluations",
  { hours: 1 },
  internal.crown.recoverStuckEvaluations
);

// Auto-refresh crown evaluations that succeeded with empty diffs
// Runs every hour to re-evaluate when fresh diffs may be available from GitHub
crons.interval(
  "auto-refresh empty diff evaluations",
  { hours: 1 },
  internal.crown.autoRefreshEmptyDiffEvaluations
);

// Recover tasks where all runs completed but no crown evaluation was created
// This handles cases where worker completion flow was interrupted
// Runs every hour to detect and auto-evaluate via GitHub API
crons.interval(
  "recover missing crown evaluations",
  { hours: 1 },
  internal.crown.recoverMissingEvaluations
);

// Clean up stale warm pool entries daily at 11:30 UTC
crons.daily(
  "cleanup warm pool",
  { hourUTC: 11, minuteUTC: 30 },
  internal.warmPoolMaintenance.cleanupWarmPool
);

// Seed curated models daily at 5:30 UTC (ensures models table is populated)
crons.daily(
  "seed curated models",
  { hourUTC: 5, minuteUTC: 30 },
  internal.modelDiscovery.seedCuratedModels
);

// Discover new models from OpenCode Zen API weekly (Saturday 6:00 UTC)
crons.weekly(
  "discover opencode models",
  { dayOfWeek: "saturday", hourUTC: 6, minuteUTC: 0 },
  internal.modelDiscovery.discoverOpencodeModels
);

// Discover new models from OpenRouter API weekly (Saturday 7:00 UTC)
// Runs after OpenCode discovery
crons.weekly(
  "discover openrouter models",
  { dayOfWeek: "saturday", hourUTC: 7, minuteUTC: 0 },
  internal.modelDiscovery.discoverOpenRouterModels
);

// Discover new models from OpenAI API weekly (Saturday 8:00 UTC)
// Requires OPENAI_API_KEY env var, discovers Codex-relevant models
crons.weekly(
  "discover openai models",
  { dayOfWeek: "saturday", hourUTC: 8, minuteUTC: 0 },
  internal.modelDiscovery.discoverOpenAIModels
);

// Discover new models from Anthropic API weekly (Saturday 9:00 UTC)
// Requires ANTHROPIC_API_KEY env var, discovers Claude Code relevant models
crons.weekly(
  "discover anthropic models",
  { dayOfWeek: "saturday", hourUTC: 9, minuteUTC: 0 },
  internal.modelDiscovery.discoverAnthropicModels
);

// Refresh expiring Codex OAuth tokens every 15 minutes
// Centralizes token refresh to avoid stale refresh_token issues in sandboxes
crons.interval(
  "refresh codex oauth tokens",
  { minutes: 15 },
  internal.codexTokenRefresh.refreshExpiring
);

// Poll orchestration tasks every minute for auto-spawning
// This enables autonomous multi-agent orchestration
// The worker uses task-run JWTs for authentication (bypasses Stack Auth)
crons.interval(
  "poll orchestration tasks",
  { minutes: 1 },
  internal.orchestrationWorker.pollReadyTasks
);

// Clean up orphan orchestration tasks (pending 7+ days with no activity)
// Runs daily at 22:30 UTC (6:30 AM HKT)
crons.daily(
  "cleanup orphan orchestration tasks",
  { hourUTC: 22, minuteUTC: 30 },
  internal.orchestrationWorker.cleanupOrphanTasks
);

export default crons;
