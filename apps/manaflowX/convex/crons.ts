import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run PR monitor every minute (will check if enabled before running)
crons.interval(
  "pr-monitor",
  { minutes: 1 },
  internal.prMonitor.cronFetchAndPostPR
);

export default crons;
