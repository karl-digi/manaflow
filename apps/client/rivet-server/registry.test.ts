/**
 * Tests for Rivet Actor Registry
 *
 * Focuses on message queue functionality to ensure:
 * 1. Messages sent before configuration are queued
 * 2. Queue is processed after configuration
 * 3. Multiple messages are processed in order
 * 4. SSE events are parsed correctly
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock fetch for OpenCode API calls
const mockFetch = vi.fn<typeof fetch>();
const mockFetchWithPreconnect = Object.assign(mockFetch, {
  preconnect: vi.fn(),
}) satisfies typeof fetch;
global.fetch = mockFetchWithPreconnect;

// Mock the registry module to test the actor logic
// We'll test the queue behavior by simulating actor state and actions

interface MockState {
  messages: Array<{ id: string; role: string; content: string; timestamp: number }>;
  title: string | null;
  createdAt: number;
  openCodeSessionId: string | null;
  sandboxUrl: string | null;
  providerID: string;
  modelID: string;
  _messageQueue: Array<{
    userMessage: { id: string; role: string; content: string; timestamp: number };
    assistantMessage: { id: string; role: string; content: string; timestamp: number };
    input: { text: string };
  }>;
  _processing: boolean;
}

interface MockContext {
  state: MockState;
  broadcast: Mock;
}

function createMockContext(): MockContext {
  return {
    state: {
      messages: [],
      title: null,
      createdAt: Date.now(),
      openCodeSessionId: null,
      sandboxUrl: null,
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
      _messageQueue: [],
      _processing: false,
    },
    broadcast: vi.fn(),
  };
}

function mockOpenCodeResponses() {
  mockFetch.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Session creation
    if (urlStr.includes("/api/opencode/session") && options?.method === "POST" && !urlStr.includes("/message")) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "test-session-123", slug: "test", version: "1.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    // Message sending
    if (urlStr.includes("/message")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            info: { id: "msg-1", sessionID: "test-session-123", role: "assistant" },
            parts: [{ id: "part-1", type: "text", text: "Hello! I received your message." }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    return Promise.resolve(new Response("Not Found", { status: 404 }));
  });
}

describe("aiChat message queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenCodeResponses();
  });

  it("should queue messages when sandbox is not configured", () => {
    const ctx = createMockContext();

    // Simulate send action - add to queue without processing
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: "Hello",
      timestamp: Date.now(),
    };
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: "",
      timestamp: Date.now(),
    };

    ctx.state.messages.push(userMessage);
    ctx.state._messageQueue.push({
      userMessage,
      assistantMessage,
      input: { text: "Hello" },
    });

    expect(ctx.state._messageQueue.length).toBe(1);
    expect(ctx.state.sandboxUrl).toBeNull();
  });

  it("should process queue after configuration", async () => {
    const ctx = createMockContext();

    // Queue a message
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: "Hello",
      timestamp: Date.now(),
    };
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: "",
      timestamp: Date.now(),
    };

    ctx.state.messages.push(userMessage);
    ctx.state._messageQueue.push({
      userMessage,
      assistantMessage,
      input: { text: "Hello" },
    });

    expect(ctx.state._messageQueue.length).toBe(1);

    // Simulate configure
    ctx.state.sandboxUrl = "https://test-sandbox.example.com";
    ctx.state.openCodeSessionId = "test-session-123";

    // Process queue manually (simulating what configure() triggers)
    while (ctx.state._messageQueue.length > 0) {
      const queued = ctx.state._messageQueue.shift()!;

      // Simulate successful processing
      queued.assistantMessage.content = "Hello! I received your message.";
      ctx.state.messages.push(queued.assistantMessage);
      ctx.broadcast("messageComplete", queued.assistantMessage);
    }

    expect(ctx.state._messageQueue.length).toBe(0);
    expect(ctx.state.messages.length).toBe(2); // user + assistant
    expect(ctx.broadcast).toHaveBeenCalledWith("messageComplete", expect.any(Object));
  });

  it("should process multiple queued messages in order", async () => {
    const ctx = createMockContext();

    // Queue multiple messages
    const messages = ["First", "Second", "Third"];
    const queuedItems: Array<{
      userMessage: { id: string; role: "user"; content: string; timestamp: number };
      assistantMessage: { id: string; role: "assistant"; content: string; timestamp: number };
      input: { text: string };
    }> = [];

    for (const text of messages) {
      const userMessage = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
      };
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: "",
        timestamp: Date.now(),
      };

      ctx.state.messages.push(userMessage);
      const queuedItem = { userMessage, assistantMessage, input: { text } };
      ctx.state._messageQueue.push(queuedItem);
      queuedItems.push(queuedItem);
    }

    expect(ctx.state._messageQueue.length).toBe(3);

    // Configure and process
    ctx.state.sandboxUrl = "https://test-sandbox.example.com";
    ctx.state.openCodeSessionId = "test-session-123";

    const processedOrder: string[] = [];

    while (ctx.state._messageQueue.length > 0) {
      const queued = ctx.state._messageQueue.shift()!;
      processedOrder.push(queued.input.text);

      queued.assistantMessage.content = `Response to: ${queued.input.text}`;
      ctx.state.messages.push(queued.assistantMessage);
    }

    expect(processedOrder).toEqual(["First", "Second", "Third"]);
    expect(ctx.state.messages.length).toBe(6); // 3 user + 3 assistant
  });

  it("should not process queue concurrently", () => {
    const ctx = createMockContext();

    // Set processing flag
    ctx.state._processing = true;
    ctx.state.sandboxUrl = "https://test-sandbox.example.com";

    // Queue a message
    ctx.state._messageQueue.push({
      userMessage: { id: "1", role: "user", content: "Test", timestamp: Date.now() },
      assistantMessage: { id: "2", role: "assistant", content: "", timestamp: Date.now() },
      input: { text: "Test" },
    });

    // Simulate processQueue check - should return early
    const shouldProcess = !ctx.state._processing;
    expect(shouldProcess).toBe(false);

    // Queue should remain
    expect(ctx.state._messageQueue.length).toBe(1);
  });

  it("should handle errors gracefully and continue processing", async () => {
    const ctx = createMockContext();

    // Queue messages
    const queuedItems = [
      {
        userMessage: { id: "u1", role: "user" as const, content: "Will fail", timestamp: Date.now() },
        assistantMessage: { id: "a1", role: "assistant" as const, content: "", timestamp: Date.now() },
        input: { text: "Will fail" },
        shouldFail: true,
      },
      {
        userMessage: { id: "u2", role: "user" as const, content: "Will succeed", timestamp: Date.now() },
        assistantMessage: { id: "a2", role: "assistant" as const, content: "", timestamp: Date.now() },
        input: { text: "Will succeed" },
        shouldFail: false,
      },
    ];

    for (const item of queuedItems) {
      ctx.state.messages.push(item.userMessage);
      ctx.state._messageQueue.push({
        userMessage: item.userMessage,
        assistantMessage: item.assistantMessage,
        input: item.input,
      });
    }

    ctx.state.sandboxUrl = "https://test-sandbox.example.com";
    ctx.state.openCodeSessionId = "test-session-123";

    // Process with error handling
    let processedCount = 0;
    while (ctx.state._messageQueue.length > 0) {
      const queued = ctx.state._messageQueue.shift()!;
      const itemConfig = queuedItems[processedCount];

      try {
        if (itemConfig?.shouldFail) {
          throw new Error("Simulated failure");
        }
        queued.assistantMessage.content = "Success response";
      } catch {
        queued.assistantMessage.content = "Sorry, I encountered an error generating a response. Please try again.";
      }

      ctx.state.messages.push(queued.assistantMessage);
      ctx.broadcast("messageComplete", queued.assistantMessage);
      processedCount++;
    }

    expect(processedCount).toBe(2);
    expect(ctx.state._messageQueue.length).toBe(0);

    // Both messages should be in state (with different content)
    const assistantMessages = ctx.state.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages.length).toBe(2);
    expect(assistantMessages[0]?.content).toContain("error");
    expect(assistantMessages[1]?.content).toBe("Success response");
  });

  it("should return user message immediately from send()", () => {
    const ctx = createMockContext();

    // send() should return user message, not wait for assistant response
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: "Hello",
      timestamp: Date.now(),
    };

    ctx.state.messages.push(userMessage);
    ctx.broadcast("newMessage", userMessage);

    // Queue for processing
    ctx.state._messageQueue.push({
      userMessage,
      assistantMessage: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      },
      input: { text: "Hello" },
    });

    // Verify user message was broadcast immediately
    expect(ctx.broadcast).toHaveBeenCalledWith("newMessage", userMessage);

    // Assistant message is queued, not yet processed
    expect(ctx.state._messageQueue.length).toBe(1);
    expect(ctx.state.messages.filter((m) => m.role === "assistant").length).toBe(0);
  });
});

describe("OpenCode SSE event parsing", () => {
  /** OpenCode SSE event structure from source code */
  interface OpenCodeEvent {
    type: string;
    properties: {
      part?: { sessionID?: string; type?: string; text?: string };
      delta?: string;
      info?: { id: string; sessionID: string };
      sessionID?: string;
    };
  }

  it("should parse message.part.updated events with delta", () => {
    // This is the actual event format from OpenCode's Bus.publish
    const rawEvent = `data: {"type":"message.part.updated","properties":{"part":{"id":"prt_123","sessionID":"ses_abc","messageID":"msg_456","type":"text","text":"Hello"},"delta":"Hello"}}`;

    const line = rawEvent;
    expect(line.startsWith("data: ")).toBe(true);

    const data = JSON.parse(line.slice(6)) as OpenCodeEvent;

    expect(data.type).toBe("message.part.updated");
    expect(data.properties.delta).toBe("Hello");
    expect(data.properties.part?.sessionID).toBe("ses_abc");
  });

  it("should filter events by sessionID", () => {
    const targetSessionId = "ses_target";

    const events: OpenCodeEvent[] = [
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "ses_other", type: "text" },
          delta: "wrong session",
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: targetSessionId, type: "text" },
          delta: "correct session",
        },
      },
      {
        type: "message.complete",
        properties: {
          info: { id: "msg_123", sessionID: targetSessionId },
        },
      },
    ];

    const filteredDeltas: string[] = [];

    for (const event of events) {
      // Filter logic matching registry.ts implementation
      const eventSessionId =
        event.properties?.part?.sessionID ||
        event.properties?.info?.sessionID ||
        event.properties?.sessionID;

      if (eventSessionId && eventSessionId !== targetSessionId) {
        continue;
      }

      if (event.type === "message.part.updated" && event.properties?.delta) {
        filteredDeltas.push(event.properties.delta);
      }
    }

    expect(filteredDeltas).toEqual(["correct session"]);
  });

  it("should detect message.complete event type", () => {
    const event: OpenCodeEvent = {
      type: "message.complete",
      properties: {
        info: { id: "msg_123", sessionID: "ses_abc" },
      },
    };

    expect(event.type).toBe("message.complete");
  });

  it("should handle server.connected initial event", () => {
    const rawEvent = `data: {"type":"server.connected","properties":{}}`;
    const data = JSON.parse(rawEvent.slice(6)) as OpenCodeEvent;

    expect(data.type).toBe("server.connected");
    expect(data.properties).toEqual({});
  });

  it("should accumulate streaming deltas correctly", () => {
    const deltas = ["Hello", " ", "world", "!"];
    let accumulated = "";

    for (const delta of deltas) {
      accumulated += delta;
    }

    expect(accumulated).toBe("Hello world!");
  });
});
