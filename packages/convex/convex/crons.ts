import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sandbox instance lifecycle maintenance (all providers: morph, pve-lxc, docker, daytona)
// Runs daily at 18:00 UTC (2 AM HKT)
crons.daily(
  "pause old sandbox instances",
  { hourUTC: 18, minuteUTC: 0 },
  internal.sandboxInstanceMaintenance.pauseOldSandboxInstances
);

// Stop inactive sandbox instances (paused for >14 days)
// Runs daily at 18:20 UTC (2:20 AM HKT)
crons.daily(
  "stop old sandbox instances",
  { hourUTC: 18, minuteUTC: 20 },
  internal.sandboxInstanceMaintenance.stopOldSandboxInstances
);

// Clean up orphaned containers (exist in provider but not in Convex)
// Runs daily at 18:40 UTC (2:40 AM HKT)
crons.daily(
  "cleanup orphaned containers",
  { hourUTC: 18, minuteUTC: 40 },
  internal.sandboxInstanceMaintenance.cleanupOrphanedContainers
);

export default crons;
