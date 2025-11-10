import type { Id } from "@cmux/convex/dataModel";

export type LocalWorkspaceOption = {
  fullName: string;
  repoBaseName: string;
  keywords: string[];
};

export type CloudWorkspaceOption =
  | {
      type: "environment";
      environmentId: Id<"environments">;
      name: string;
      keywords: string[];
    }
  | {
      type: "repo";
      fullName: string;
      repoBaseName: string;
      keywords: string[];
    };
