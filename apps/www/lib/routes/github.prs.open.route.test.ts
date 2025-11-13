import { testApiClient } from "@/lib/test-utils/openapi-client";
import {
  postApiIntegrationsGithubPrsOpen,
  type PostApiIntegrationsGithubPrsOpenData,
} from "@cmux/www-openapi-client";
import { describe, expect, it } from "vitest";

const MOCK_TASK_RUN_ID: PostApiIntegrationsGithubPrsOpenData["body"]["taskRunId"] =
  "taskRuns:000000000000000000000000";

describe("githubPrsOpenRouter via SDK", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await postApiIntegrationsGithubPrsOpen({
      client: testApiClient,
      body: {
        teamSlugOrId: "example-team",
        taskRunId: MOCK_TASK_RUN_ID,
      },
    });

    expect(res.response.status).toBe(401);
  });
});
