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

// Stop inactive sandbox instances (paused for >14 days)
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

// Recover crown evaluations stuck in pending/in_progress state
// Runs every hour to detect evaluations that failed without proper error handling
crons.interval(
  "recover stuck crown evaluations",
  { hours: 1 },
  internal.crown.recoverStuckEvaluations
);

export default crons;
