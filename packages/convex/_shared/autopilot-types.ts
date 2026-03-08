/**
 * Shared autopilot types and constants.
 *
 * Autopilot mode allows agents to run for extended periods with heartbeat-based
 * timeout extension, status tracking, and session resume capabilities.
 */

/**
 * Valid autopilot status values.
 * - running: Agent is actively working
 * - paused: Agent is temporarily paused
 * - wrap-up: Agent is in wrap-up mode before deadline
 * - completed: Agent has completed successfully
 * - stopped: Agent was stopped (manually or due to error)
 */
export const AUTOPILOT_STATUSES = [
  "running",
  "paused",
  "wrap-up",
  "completed",
  "stopped",
] as const;

export type AutopilotStatus = (typeof AUTOPILOT_STATUSES)[number];
