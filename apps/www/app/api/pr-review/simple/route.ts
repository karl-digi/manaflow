import { NextRequest, NextResponse } from "next/server";

import { stackServerApp } from "@/lib/utils/stack";
import { runSimpleAnthropicReviewStream } from "@/lib/services/code-review/run-simple-anthropic-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRepoFullName(repoFullName: string | null): {
  owner: string;
  repo: string;
} | null {
  if (!repoFullName) {
    return null;
  }
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

function parsePrNumber(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const repoFullName = parseRepoFullName(searchParams.get("repoFullName"));
    const prNumber = parsePrNumber(searchParams.get("prNumber"));

    if (!repoFullName || prNumber === null) {
      return NextResponse.json(
        { error: "repoFullName and prNumber query params are required" },
        { status: 400 }
      );
    }

    const user = await stackServerApp.getUser({ or: "return-null" });
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const githubAccount = await user.getConnectedAccount("github");
    if (!githubAccount) {
      return NextResponse.json(
        { error: "GitHub account is not connected" },
        { status: 403 }
      );
    }

    const { accessToken: githubToken } = await githubAccount.getAccessToken();
    if (!githubToken) {
      return NextResponse.json(
        { error: "GitHub access token unavailable" },
        { status: 403 }
      );
    }

    const prIdentifier = `https://github.com/${repoFullName.owner}/${repoFullName.repo}/pull/${prNumber}`;

    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (payload: unknown) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        };

        enqueue({ type: "status", message: "starting" });

        try {
          await runSimpleAnthropicReviewStream({
            prIdentifier,
            githubToken,
            signal: abortController.signal,
            onEvent: async (event) => {
              switch (event.type) {
                case "file":
                  enqueue({
                    type: "file",
                    filePath: event.filePath,
                  });
                  break;
                case "skip":
                  enqueue({
                    type: "skip",
                    filePath: event.filePath,
                    reason: event.reason,
                  });
                  break;
                case "hunk":
                  enqueue({
                    type: "hunk",
                    filePath: event.filePath,
                    header: event.header,
                  });
                  break;
                case "file-complete":
                  enqueue({
                    type: "file-complete",
                    filePath: event.filePath,
                    status: event.status,
                    summary: event.summary,
                  });
                  break;
                case "line": {
                  const {
                    changeType,
                    diffLine,
                    codeLine,
                    mostImportantWord,
                    shouldReviewWhy,
                    score,
                    scoreNormalized,
                    oldLineNumber,
                    newLineNumber,
                  } = event.line;

                  enqueue({
                    type: "line",
                    filePath: event.filePath,
                    changeType,
                    diffLine,
                    codeLine,
                    mostImportantWord,
                    shouldReviewWhy,
                    score,
                    scoreNormalized,
                    oldLineNumber,
                    newLineNumber,
                    line: event.line,
                  });
                  break;
                }
                default:
                  break;
              }
            },
          });
          enqueue({ type: "complete" });
          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          console.error("[simple-review][api] Stream failed", {
            prIdentifier,
            message,
            error,
          });
          enqueue({ type: "error", message });
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("[simple-review][api] Unexpected failure", {
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
