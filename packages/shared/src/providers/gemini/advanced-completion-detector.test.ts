import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAdvancedGeminiCompletionDetector,
  waitForUserTurn,
  waitForAgentFinish,
} from "./advanced-completion-detector";

describe("Advanced Gemini Completion Detector", () => {
  let testDir: string;
  let telemetryPath: string;
  const taskRunId = "test-task-123";

  beforeEach(async () => {
    testDir = join(tmpdir(), `gemini-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    telemetryPath = `/tmp/gemini-telemetry-${taskRunId}.log`;
  });

  afterEach(async () => {
    try {
      await unlink(telemetryPath);
    } catch {
      // File might not exist
    }
  });

  test("detects next_speaker_check event with result=user", async () => {
    const events: string[] = [];

    const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
      onNextSpeakerCheck: (event) => {
        events.push(`next_speaker:${event.data.result}`);
        if (event.data.result === "user") {
          detector.stop();
        }
      },
    });

    // Start detector
    const startPromise = detector.start();

    // Wait a bit for detector to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Write telemetry event
    const telemetryEvent = {
      attributes: {
        "event.name": "gemini_cli.next_speaker_check",
        result: "user",
        finish_reason: "STOP",
      },
    };

    await writeFile(telemetryPath, JSON.stringify(telemetryEvent) + "\n");

    // Wait for detection (with timeout)
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      new Promise((resolve) => {
        const interval = setInterval(() => {
          if (!detector.isWatching()) {
            clearInterval(interval);
            resolve(undefined);
          }
        }, 100);
      }),
    ]);

    expect(events).toContain("next_speaker:user");
    detector.stop();
  });

  test("detects agent_finish event", async () => {
    const events: string[] = [];

    const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
      onAgentFinish: (event) => {
        events.push(
          `agent_finish:${event.data.terminateReason}:${event.data.turnCount}`
        );
        detector.stop();
      },
    });

    await detector.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const telemetryEvent = {
      attributes: {
        "event.name": "gemini_cli.agent.finish",
        terminate_reason: "GOAL",
        turn_count: 5,
        duration_ms: 1200,
      },
    };

    await writeFile(telemetryPath, JSON.stringify(telemetryEvent) + "\n");

    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      new Promise((resolve) => {
        const interval = setInterval(() => {
          if (!detector.isWatching()) {
            clearInterval(interval);
            resolve(undefined);
          }
        }, 100);
      }),
    ]);

    expect(events).toContain("agent_finish:GOAL:5");
    detector.stop();
  });

  test("detects complete_task tool call", async () => {
    const events: string[] = [];

    const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
      onAgentCompleteTask: (event) => {
        events.push(`complete_task:${event.data.functionName}`);
        detector.stop();
      },
    });

    await detector.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const telemetryEvent = {
      attributes: {
        "event.name": "gemini_cli.tool_call",
        function_name: "complete_task",
      },
    };

    await writeFile(telemetryPath, JSON.stringify(telemetryEvent) + "\n");

    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      new Promise((resolve) => {
        const interval = setInterval(() => {
          if (!detector.isWatching()) {
            clearInterval(interval);
            resolve(undefined);
          }
        }, 100);
      }),
    ]);

    expect(events).toContain("complete_task:complete_task");
    detector.stop();
  });

  test("detects conversation_finished event", async () => {
    const events: string[] = [];

    const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
      onConversationFinished: (event) => {
        events.push(`conversation_finished:${event.data.turnCount}`);
        detector.stop();
      },
    });

    await detector.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const telemetryEvent = {
      attributes: {
        "event.name": "gemini_cli.conversation_finished",
        turn_count: 10,
      },
    };

    await writeFile(telemetryPath, JSON.stringify(telemetryEvent) + "\n");

    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      new Promise((resolve) => {
        const interval = setInterval(() => {
          if (!detector.isWatching()) {
            clearInterval(interval);
            resolve(undefined);
          }
        }, 100);
      }),
    ]);

    expect(events).toContain("conversation_finished:10");
    detector.stop();
  });

  test("handles multiple events in sequence", async () => {
    const events: string[] = [];

    const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
      onNextSpeakerCheck: (event) => {
        events.push(`check:${event.data.result}`);
      },
      onAgentCompleteTask: () => {
        events.push("complete");
      },
      onAgentFinish: (event) => {
        events.push(`finish:${event.data.terminateReason}`);
        detector.stop();
      },
    });

    await detector.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Write multiple events
    const events1 = [
      {
        attributes: {
          "event.name": "gemini_cli.next_speaker_check",
          result: "model",
        },
      },
      {
        attributes: {
          "event.name": "gemini_cli.tool_call",
          function_name: "complete_task",
        },
      },
      {
        attributes: {
          "event.name": "gemini_cli.agent.finish",
          terminate_reason: "GOAL",
          turn_count: 3,
        },
      },
    ];

    await writeFile(
      telemetryPath,
      events1.map((e) => JSON.stringify(e)).join("\n") + "\n"
    );

    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      new Promise((resolve) => {
        const interval = setInterval(() => {
          if (!detector.isWatching()) {
            clearInterval(interval);
            resolve(undefined);
          }
        }, 100);
      }),
    ]);

    expect(events).toContain("check:model");
    expect(events).toContain("complete");
    expect(events).toContain("finish:GOAL");
    detector.stop();
  });
});
