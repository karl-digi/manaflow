import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Pause Morph instances older than 20 hours
// Runs daily at 5 AM Pacific Time
// 5 AM PST = 13:00 UTC (during standard time)
// 5 AM PDT = 12:00 UTC (during daylight saving)
// Using 13:00 UTC means it runs at 5 AM PST or 6 AM PDT
crons.daily(
  "pause old morph instances",
  { hourUTC: 13, minuteUTC: 0 },
  internal.morphInstanceMaintenance.pauseOldMorphInstances
);

export default crons;
