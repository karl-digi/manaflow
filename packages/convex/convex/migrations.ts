// To run migrations:
// bunx convex run migrations:run '{fn: "migrations:setDefaultValue"}'

import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);

// Backfill teams.teamId from legacy teams.uuid when missing
export const backfillTeamsTeamId = migrations.define({
  table: "teams",
  migrateOne: (_ctx, doc) => {
    const d = doc as unknown as { teamId?: string } & Record<string, unknown>;
    if (d.teamId === undefined) {
      const legacy = (d as Record<string, unknown>)["uuid"];
      if (typeof legacy === "string") {
        return { teamId: legacy } as Partial<typeof doc>;
      }
    }
  },
});

// Backfill users.userId from legacy users.uuid when missing
export const backfillUsersUserId = migrations.define({
  table: "users",
  migrateOne: (_ctx, doc) => {
    const d = doc as unknown as { userId?: string } & Record<string, unknown>;
    if (d.userId === undefined) {
      const legacy = (d as Record<string, unknown>)["uuid"];
      if (typeof legacy === "string") {
        return { userId: legacy } as Partial<typeof doc>;
      }
    }
  },
});

export const dropUsersUuid = migrations.define({
  table: "users",
  migrateOne: (_ctx, doc) => {
    return { userId: doc.userId, uuid: undefined } as Partial<typeof doc>;
  },
});

export const dropTeamsUuid = migrations.define({
  table: "teams",
  migrateOne: (_ctx, doc) => {
    return { teamId: doc.teamId, uuid: undefined } as Partial<typeof doc>;
  },
});

// Remove deprecated CLI output logs retained on historical task runs
export const clearTaskRunsLog = migrations.define({
  table: "taskRuns",
  migrateOne: (_ctx, doc) => {
    if (doc.log === undefined) {
      return;
    }
    return { log: undefined };
  },
});

// Generic runner; choose migrations from CLI or dashboard when invoking
export const run = migrations.runner();
