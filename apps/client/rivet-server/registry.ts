/**
 * Rivet Actor Registry
 *
 * This file defines the actors for the Rivet demo.
 * The server imports and runs these actors.
 * The client imports only the TYPE for end-to-end type safety.
 */
import { actor, setup, UserError } from "rivetkit";

// ============================================================================
// OpenCode API Client
// ============================================================================

interface OpenCodeSession {
  id: string;
  slug: string;
  version: string;
  projectID: string;
  directory: string;
  title: string;
}

// Input part types for sending messages
interface OpenCodeTextPartInput {
  type: "text";
  text: string;
}

interface OpenCodeFilePartInput {
  type: "file";
  mime: string;
  url: string; // data URL: data:{mime};base64,{encoded_data}
  filename?: string;
}

type OpenCodePartInput = OpenCodeTextPartInput | OpenCodeFilePartInput;

// Response part types
interface OpenCodeResponsePart {
  id: string;
  type: "text" | "step-start" | "step-finish" | "reasoning" | "file" | "tool-call" | "tool-result";
  text?: string;
  mime?: string;
  url?: string;
  // Tool call fields
  tool?: string;
  args?: Record<string, unknown>;
  // Tool result fields
  result?: unknown;
  error?: string;
}

interface OpenCodeMessageResponse {
  info: {
    id: string;
    sessionID: string;
    role: string;
    modelID: string;
    providerID: string;
  };
  parts: OpenCodeResponsePart[];
}

async function getOrCreateOpenCodeSession(sandboxUrl: string): Promise<string> {
  const response = await fetch(`${sandboxUrl}/api/opencode/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Failed to create OpenCode session: ${response.status}`);
  }
  const session = (await response.json()) as OpenCodeSession;
  return session.id;
}

/** OpenCode SSE event types - events are { type, properties } */
interface OpenCodeEvent {
  type: string;
  properties: {
    part?: OpenCodeResponsePart & { sessionID?: string };
    delta?: string;
    info?: {
      id: string;
      sessionID: string;
      time?: { created?: number; completed?: number };
    };
    sessionID?: string;
    messageID?: string;
  };
}

/**
 * Stream OpenCode response via SSE events.
 * Calls onEvent for each streaming event, allowing real-time updates.
 */
async function streamOpenCodeMessage(
  sandboxUrl: string,
  sessionId: string,
  parts: OpenCodePartInput[],
  providerID: string,
  modelID: string,
  onEvent: (event: OpenCodeEvent) => void
): Promise<OpenCodeMessageResponse> {
  // Start SSE connection to receive streaming events
  // Note: /event endpoint doesn't support sessionID filtering, we filter client-side
  const eventUrl = `${sandboxUrl}/api/opencode/event`;

  let messageComplete = false;
  let finalResponse: OpenCodeMessageResponse | null = null;

  // Set up SSE with fetch (EventSource not available in Bun workers)
  const abortController = new AbortController();
  const sseTimeout = setTimeout(() => {
    if (!messageComplete) {
      abortController.abort();
      console.error("[OpenCode SSE] Timeout");
    }
  }, 60000); // 60s timeout

  // Start SSE listener BEFORE sending message
  const sseTask = (async () => {
    try {
      const sseResponse = await fetch(eventUrl, {
        signal: abortController.signal,
        headers: { Accept: "text/event-stream" },
      });

      if (!sseResponse.ok || !sseResponse.body) {
        console.error("[OpenCode SSE] Failed to connect:", sseResponse.status);
        return; // Fall back to non-streaming
      }

      const reader = sseResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!messageComplete) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as OpenCodeEvent;

              // Filter by sessionID - event can have sessionID in multiple places
              const eventSessionId =
                data.properties?.part?.sessionID ||
                data.properties?.info?.sessionID ||
                data.properties?.sessionID;

              if (eventSessionId && eventSessionId !== sessionId) {
                continue; // Skip events for other sessions
              }

              onEvent(data);

              // Message complete - check multiple completion indicators
              // OpenCode uses session.idle or message.updated with time.completed
              if (data.type === "message.complete") {
                messageComplete = true;
                break;
              }
              if (data.type === "session.idle") {
                messageComplete = true;
                break;
              }
              // Also check for message.updated with completed timestamp
              if (data.type === "message.updated" && data.properties?.info?.time?.completed) {
                messageComplete = true;
                break;
              }
            } catch (error) {
              console.error("[OpenCode SSE] Failed to parse event", error);
            }
          }
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        console.error("[OpenCode SSE] Error:", err);
      }
    }
  })();

  // Give SSE a moment to connect before sending message
  await new Promise((r) => setTimeout(r, 50));

  // Send the message (this triggers SSE events)
  const response = await fetch(
    `${sandboxUrl}/api/opencode/session/${sessionId}/message`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts, providerID, modelID }),
    }
  );

  if (!response.ok) {
    clearTimeout(sseTimeout);
    abortController.abort();
    const text = await response.text();
    throw new Error(`OpenCode message failed: ${response.status} - ${text}`);
  }

  finalResponse = (await response.json()) as OpenCodeMessageResponse;

  // Clean up SSE
  clearTimeout(sseTimeout);
  messageComplete = true;
  abortController.abort();

  // Wait briefly for SSE to finish processing
  await Promise.race([sseTask, new Promise((r) => setTimeout(r, 100))]);

  return finalResponse;
}

function extractTextFromParts(parts: OpenCodeResponsePart[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text ?? "")
    .join("");
}

function extractToolCallsFromParts(parts: OpenCodeResponsePart[]): ToolCall[] {
  return parts
    .filter((p) => p.type === "tool-call" && p.tool)
    .map((p) => ({
      id: p.id,
      tool: p.tool!,
      args: p.args,
      result: p.result,
      error: p.error,
      status: p.error ? "failed" as const : p.result !== undefined ? "completed" as const : "pending" as const,
    }));
}

// ============================================================================
// Types (exported for client use)
// ============================================================================

export interface ImageAttachment {
  /** MIME type (e.g., "image/png", "image/jpeg") */
  mime: string;
  /** Base64-encoded data URL: data:{mime};base64,{encoded_data} */
  url: string;
  /** Optional filename */
  filename?: string;
}

export interface ToolCall {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Optional image attachments */
  images?: ImageAttachment[];
  /** Tool calls made by the assistant */
  toolCalls?: ToolCall[];
  timestamp: number;
}

export interface SendMessageInput {
  /** Text content of the message */
  text: string;
  /** Optional image attachments as base64 data URLs */
  images?: ImageAttachment[];
}

export interface ChatInfo {
  title: string | null;
  createdAt: number;
  messageCount: number;
}

// ============================================================================
// Actors
// ============================================================================

/** Queued message waiting to be processed */
interface QueuedMessage {
  userMessage: Message;
  assistantMessage: Message;
  input: SendMessageInput;
}

type AiChatContext = {
  state: {
    messages: Message[];
    title: string | null;
    createdAt: number;
    openCodeSessionId: string | null;
    sandboxUrl: string | null;
    providerID: string;
    modelID: string;
    _messageQueue: QueuedMessage[];
    _processing: boolean;
  };
  broadcast: (event: string, payload: unknown) => void;
};

const aiChat = actor({
  state: {
    messages: [] as Message[],
    title: null as string | null,
    createdAt: Date.now(),
    openCodeSessionId: null as string | null,
    sandboxUrl: null as string | null,
    providerID: "opencode" as string,
    modelID: "trinity-large-preview-free" as string,
    /** Queue of messages waiting to be processed */
    _messageQueue: [] as QueuedMessage[],
    /** Flag indicating queue is being processed */
    _processing: false as boolean,
  },

  createConnState: (_c, params: { visitorId: string }) => {
    if (!params.visitorId) {
      throw new UserError("Visitor ID required", { code: "missing_visitor_id" });
    }
    return { visitorId: params.visitorId };
  },

  // Note: onConnect cannot use conn.send() directly in rivetkit
  // Client should call getHistory() action after connecting

  actions: {
    /**
     * Configure the sandbox URL for OpenCode integration.
     * Triggers processing of any queued messages.
     */
    configure: async (
      c,
      config: { sandboxUrl: string; providerID?: string; modelID?: string }
    ): Promise<void> => {
      c.state.sandboxUrl = config.sandboxUrl;
      if (config.providerID) c.state.providerID = config.providerID;
      if (config.modelID) c.state.modelID = config.modelID;

      // Create OpenCode session immediately
      const sessionId = await getOrCreateOpenCodeSession(config.sandboxUrl);
      c.state.openCodeSessionId = sessionId;
      console.log(`[aiChat] Configured with sandbox ${config.sandboxUrl}, session ${sessionId}`);

      // Process any queued messages
      await processQueue(c);
    },

    /**
     * Send a message with optional image attachments.
     * Returns immediately - response is streamed via events.
     * @param input - Either a string (text only) or SendMessageInput object with text and images
     */
    send: async (c, input: string | SendMessageInput): Promise<Message> => {
      // Initialize missing state fields for actors created before these fields existed
      if (!c.state._messageQueue) c.state._messageQueue = [];
      if (c.state._processing === undefined) c.state._processing = false;

      // Normalize input to SendMessageInput
      const messageInput: SendMessageInput =
        typeof input === "string" ? { text: input } : input;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: messageInput.text,
        images: messageInput.images,
        timestamp: Date.now(),
      };
      c.state.messages.push(userMessage);
      c.broadcast("newMessage", userMessage);

      if (!c.state.title && c.state.messages.length === 1) {
        c.state.title =
          messageInput.text.slice(0, 50) +
          (messageInput.text.length > 50 ? "..." : "");
        c.broadcast("titleUpdated", c.state.title);
      }

      // Create assistant message placeholder
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        toolCalls: [],
        timestamp: Date.now(),
      };

      // Broadcast that streaming has started (shows loading indicator)
      c.broadcast("messageStart", assistantMessage);

      // Queue the message for processing
      c.state._messageQueue.push({
        userMessage,
        assistantMessage,
        input: messageInput,
      });

      // Try to process queue (will wait if not configured)
      // Don't await - let it process in background
      processQueue(c).catch((err) => {
        console.error("[aiChat] Queue processing error:", err);
      });

      return userMessage;
    },

    /** Get queue length (for testing) */
    getQueueLength: (c): number => c.state._messageQueue.length,

    getHistory: (c): Message[] => c.state.messages,

    getInfo: (c): ChatInfo => ({
      title: c.state.title,
      createdAt: c.state.createdAt,
      messageCount: c.state.messages.length,
    }),
  },
});

/** Process queued messages sequentially */
async function processQueue(c: AiChatContext): Promise<void> {
  // Initialize missing state fields for actors created before these fields existed
  if (!c.state._messageQueue) c.state._messageQueue = [];
  if (c.state._processing === undefined) c.state._processing = false;

  // Prevent concurrent processing
  if (c.state._processing) return;

  // Wait for configuration
  if (!c.state.sandboxUrl) return;

  c.state._processing = true;

  try {
    while (c.state._messageQueue.length > 0) {
      const queued = c.state._messageQueue[0];
      if (!queued) break;

      try {
        await processMessage(c, queued);
      } catch (error) {
        console.error("[aiChat] Error processing message:", error);
        // Mark message as failed
        queued.assistantMessage.content =
          "Sorry, I encountered an error generating a response. Please try again.";
        c.state.messages.push(queued.assistantMessage);
        c.broadcast("messageComplete", queued.assistantMessage);
      }

      // Remove from queue after processing
      c.state._messageQueue.shift();
    }
  } finally {
    c.state._processing = false;
  }
}

/** Process a single queued message */
async function processMessage(
  c: AiChatContext,
  queued: QueuedMessage
): Promise<void> {
  const { assistantMessage, input } = queued;

  // Ensure OpenCode session exists
  if (!c.state.openCodeSessionId && c.state.sandboxUrl) {
    c.state.openCodeSessionId = await getOrCreateOpenCodeSession(c.state.sandboxUrl);
  }

  if (!c.state.sandboxUrl || !c.state.openCodeSessionId) {
    throw new Error("Sandbox not configured");
  }

  // Build parts array with text and optional images
  const parts: OpenCodePartInput[] = [];

  if (input.text) {
    parts.push({ type: "text", text: input.text });
  }

  if (input.images) {
    for (const img of input.images) {
      parts.push({
        type: "file",
        mime: img.mime,
        url: img.url,
        filename: img.filename,
      });
    }
  }

  // Send message with streaming - broadcast events as they arrive
  const response = await streamOpenCodeMessage(
    c.state.sandboxUrl,
    c.state.openCodeSessionId,
    parts,
    c.state.providerID,
    c.state.modelID,
    (event) => {
      // Real-time streaming: broadcast each event as it arrives
      // OpenCode uses "message.part.updated" with delta in properties
      if (event.type === "message.part.updated" && event.properties?.delta) {
        const delta = event.properties.delta;
        assistantMessage.content += delta;
        c.broadcast("messageStream", {
          id: assistantMessage.id,
          delta,
          content: assistantMessage.content,
          toolCalls: assistantMessage.toolCalls,
        });
      }
    }
  );

  // Extract final text and tool calls from complete response
  const responseText = extractTextFromParts(response.parts);
  const toolCalls = extractToolCallsFromParts(response.parts);

  // If streaming didn't capture all text (fallback), add remaining
  if (assistantMessage.content.length < responseText.length) {
    const remaining = responseText.slice(assistantMessage.content.length);
    if (remaining) {
      assistantMessage.content = responseText;
      c.broadcast("messageStream", {
        id: assistantMessage.id,
        delta: remaining,
        content: assistantMessage.content,
        toolCalls: assistantMessage.toolCalls,
      });
    }
  }

  // Add tool calls
  if (toolCalls.length > 0) {
    assistantMessage.toolCalls = toolCalls;
    c.broadcast("messageStream", {
      id: assistantMessage.id,
      delta: "",
      content: assistantMessage.content,
      toolCalls: assistantMessage.toolCalls,
    });
  }

  // Save final message and broadcast completion
  c.state.messages.push(assistantMessage);
  c.broadcast("messageComplete", assistantMessage);
}

const chatList = actor({
  state: {
    chatIds: [] as string[],
  },

  createConnState: (_c, params: { visitorId: string }) => ({
    visitorId: params.visitorId,
  }),

  actions: {
    addChat: (c, chatId: string) => {
      if (!c.state.chatIds.includes(chatId)) {
        c.state.chatIds.unshift(chatId);
        c.broadcast("chatAdded", chatId);
      }
    },

    removeChat: (c, chatId: string) => {
      c.state.chatIds = c.state.chatIds.filter((id) => id !== chatId);
      c.broadcast("chatRemoved", chatId);
    },

    listChats: (c): string[] => c.state.chatIds,
  },
});

export const registry = setup({
  use: { aiChat, chatList },
  // Use a different port for the internal manager to avoid conflicting with our Bun.serve
  managerPort: 6421,
});
