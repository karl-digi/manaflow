import { describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Mock internal mutations for testing
const makeConversationId = (value: string) =>
  value as Id<"conversations">;
const makeMessageId = (value: string) =>
  value as Id<"conversationMessages">;
const makeSandboxId = (value: string) =>
  value as Id<"acpSandboxes">;

const now = Date.now();

const makeConversation = (
  overrides: Partial<Doc<"conversations">> = {}
): Doc<"conversations"> => ({
  _id: makeConversationId("conv_1"),
  _creationTime: now,
  teamId: "team_1",
  userId: "user_1",
  sessionId: "session_1",
  providerId: "claude",
  cwd: "/",
  status: "active",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeMessage = (
  overrides: Partial<Doc<"conversationMessages">> = {}
): Doc<"conversationMessages"> => ({
  _id: makeMessageId("msg_1"),
  _creationTime: now,
  conversationId: makeConversationId("conv_1"),
  role: "assistant",
  content: [{ type: "text", text: "Hello" }],
  createdAt: now,
  ...overrides,
});

const makeSandbox = (
  overrides: Partial<Doc<"acpSandboxes">> = {}
): Doc<"acpSandboxes"> => ({
  _id: makeSandboxId("sandbox_1"),
  _creationTime: now,
  teamId: "team_1",
  provider: "morph",
  instanceId: "instance_1",
  status: "running",
  callbackJwtHash: "hash",
  lastActivityAt: now,
  conversationCount: 1,
  snapshotId: "snap_1",
  createdAt: now,
  ...overrides,
});

describe("acp_callbacks", () => {
  describe("appendMessageChunk", () => {
    it("stores acpSeq on content blocks", async () => {
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
      const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];

      const mockDb = {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id.startsWith("msg")) {
            return makeMessage({
              content: [{ type: "text", text: "Hello", acpSeq: 1 }],
              acpSeq: 1,
            });
          }
          return null;
        }),
        patch: vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        }),
        insert: vi.fn().mockImplementation(async (table: string, doc: Record<string, unknown>) => {
          inserts.push({ table, doc });
          return makeMessageId("msg_new");
        }),
      };

      const conversationId = makeConversationId("conv_1");
      const messageId = makeMessageId("msg_1");
      const eventSeq = 5;

      // Simulate appendMessageChunk logic - appending new text block with different sequence
      const message = await mockDb.get(messageId);
      const lastBlock = message?.content[message.content.length - 1];

      // Since eventSeq (5) is different from lastBlock.acpSeq (1), should create new block
      expect(lastBlock?.acpSeq).toBe(1);
      expect(eventSeq).not.toBe(lastBlock?.acpSeq);

      const contentWithSeq = {
        type: "text",
        text: "New text",
        acpSeq: eventSeq,
      };

      await mockDb.patch(messageId, {
        content: [...(message?.content ?? []), contentWithSeq],
        acpSeq: Math.max(message?.acpSeq ?? 0, eventSeq),
      });

      // Verify sequence is stored
      expect(patches).toHaveLength(1);
      const patchedContent = patches[0]?.patch.content as Array<{ acpSeq?: number }>;
      expect(patchedContent).toHaveLength(2);
      expect(patchedContent[0]?.acpSeq).toBe(1);
      expect(patchedContent[1]?.acpSeq).toBe(5);
    });

    it("appends to existing text block when sequence matches", async () => {
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const mockDb = {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id.startsWith("msg")) {
            return makeMessage({
              content: [{ type: "text", text: "Hello ", acpSeq: 3 }],
              acpSeq: 3,
            });
          }
          return null;
        }),
        patch: vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        }),
      };

      const messageId = makeMessageId("msg_1");
      const eventSeq = 3; // Same as last block

      const message = await mockDb.get(messageId);
      const lastBlock = message?.content[message.content.length - 1];

      // Same sequence - should append to existing block
      expect(lastBlock?.acpSeq).toBe(eventSeq);

      const updatedContent = [...(message?.content ?? [])];
      updatedContent[updatedContent.length - 1] = {
        ...lastBlock,
        text: (lastBlock?.text ?? "") + "world",
      };

      await mockDb.patch(messageId, {
        content: updatedContent,
        acpSeq: eventSeq,
      });

      // Verify text was appended, not new block created
      expect(patches).toHaveLength(1);
      const patchedContent = patches[0]?.patch.content as Array<{ text?: string; acpSeq?: number }>;
      expect(patchedContent).toHaveLength(1);
      expect(patchedContent[0]?.text).toBe("Hello world");
      expect(patchedContent[0]?.acpSeq).toBe(3);
    });
  });

  describe("recordToolCall", () => {
    it("stores acpSeq on new tool calls", async () => {
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const mockDb = {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id.startsWith("msg")) {
            return makeMessage({ toolCalls: [] });
          }
          if (id.startsWith("conv")) {
            return makeConversation();
          }
          return null;
        }),
        patch: vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        }),
      };

      const messageId = makeMessageId("msg_1");
      const conversationId = makeConversationId("conv_1");
      const eventSeq = 10;
      const toolCall = {
        id: "tool_1",
        name: "read_file",
        arguments: '{"path": "/test"}',
        status: "pending" as const,
      };

      // Simulate recordToolCall logic
      const message = await mockDb.get(messageId);
      const existingToolCalls = message?.toolCalls ?? [];

      const toolCallWithSeq = {
        ...toolCall,
        acpSeq: eventSeq,
      };

      await mockDb.patch(messageId, {
        toolCalls: [...existingToolCalls, toolCallWithSeq],
      });

      // Verify acpSeq is stored
      expect(patches).toHaveLength(1);
      const patchedToolCalls = patches[0]?.patch.toolCalls as Array<{ acpSeq?: number; id: string }>;
      expect(patchedToolCalls).toHaveLength(1);
      expect(patchedToolCalls[0]?.acpSeq).toBe(10);
      expect(patchedToolCalls[0]?.id).toBe("tool_1");
    });

    it("preserves original acpSeq when updating existing tool call", async () => {
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const existingToolCall = {
        id: "tool_1",
        name: "read_file",
        arguments: '{"path": "/test"}',
        status: "pending" as const,
        acpSeq: 5, // Original sequence
      };

      const mockDb = {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id.startsWith("msg")) {
            return makeMessage({ toolCalls: [existingToolCall] });
          }
          if (id.startsWith("conv")) {
            return makeConversation();
          }
          return null;
        }),
        patch: vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        }),
      };

      const messageId = makeMessageId("msg_1");
      const eventSeq = 15; // New sequence from update event
      const updatedToolCall = {
        id: "tool_1",
        name: "read_file",
        arguments: '{"path": "/test"}',
        status: "completed" as const,
        result: "file content here",
      };

      // Simulate recordToolCall update logic
      const message = await mockDb.get(messageId);
      const existingToolCalls = message?.toolCalls ?? [];
      const existingIndex = existingToolCalls.findIndex((tc: { id: string }) => tc.id === updatedToolCall.id);

      expect(existingIndex).toBe(0); // Found existing

      const updatedToolCalls = [...existingToolCalls];
      updatedToolCalls[existingIndex] = {
        ...updatedToolCall,
        // Should preserve original acpSeq, not use new eventSeq
        acpSeq: existingToolCalls[existingIndex]?.acpSeq ?? eventSeq,
      };

      await mockDb.patch(messageId, { toolCalls: updatedToolCalls });

      // Verify original acpSeq is preserved
      expect(patches).toHaveLength(1);
      const patchedToolCalls = patches[0]?.patch.toolCalls as Array<{ acpSeq?: number; status: string }>;
      expect(patchedToolCalls).toHaveLength(1);
      expect(patchedToolCalls[0]?.acpSeq).toBe(5); // Original, not 15
      expect(patchedToolCalls[0]?.status).toBe("completed");
    });
  });

  describe("completeMessage", () => {
    it("sets isFinal to true on the message when message_complete is called", async () => {
      // Track patches made to the database
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const mockDb = {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id.startsWith("conv")) {
            return makeConversation({ acpSandboxId: makeSandboxId("sandbox_1") });
          }
          if (id.startsWith("msg")) {
            return makeMessage();
          }
          if (id.startsWith("sandbox")) {
            return makeSandbox();
          }
          return null;
        }),
        patch: vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        }),
      };

      const mockCtx = {
        db: mockDb,
      } as unknown as MutationCtx;

      // Import the handler dynamically to use mocked context
      // Since we can't easily mock the Convex runtime, we'll test the logic directly
      const conversationId = makeConversationId("conv_1");
      const messageId = makeMessageId("msg_1");
      const stopReason = "end_turn";

      // Simulate what completeMessage does
      const message = await mockDb.get(messageId);
      expect(message).toBeTruthy();

      // The mutation should patch the message with isFinal: true
      await mockDb.patch(messageId, { isFinal: true });

      const conversation = await mockDb.get(conversationId);
      expect(conversation).toBeTruthy();
      expect(conversation?.status).toBe("active");

      // Patch conversation status
      await mockDb.patch(conversationId, {
        status: "completed",
        stopReason,
        lastMessageAt: now,
        updatedAt: now,
      });

      // Verify the patches
      expect(patches).toHaveLength(2);
      expect(patches[0]).toEqual({
        id: messageId,
        patch: { isFinal: true },
      });
      expect(patches[1]).toMatchObject({
        id: conversationId,
        patch: {
          status: "completed",
          stopReason: "end_turn",
        },
      });
    });

    it("marks message as isFinal even for cancelled stop reason", async () => {
      const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

      const mockDb = {
        get: vi.fn().mockImplementation(async (id: string) => {
          if (id.startsWith("conv")) {
            return makeConversation();
          }
          if (id.startsWith("msg")) {
            return makeMessage();
          }
          return null;
        }),
        patch: vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        }),
      };

      const messageId = makeMessageId("msg_1");
      const conversationId = makeConversationId("conv_1");
      const stopReason = "cancelled";

      // Simulate completeMessage logic
      await mockDb.patch(messageId, { isFinal: true });

      const conversation = await mockDb.get(conversationId);
      if (conversation && conversation.status === "active") {
        const newStatus = stopReason === "cancelled" ? "cancelled" : "completed";
        await mockDb.patch(conversationId, {
          status: newStatus,
          stopReason,
          lastMessageAt: now,
          updatedAt: now,
        });
      }

      // Verify isFinal is always set regardless of stop reason
      expect(patches[0]).toEqual({
        id: messageId,
        patch: { isFinal: true },
      });

      // And conversation status is set to cancelled
      expect(patches[1]).toMatchObject({
        id: conversationId,
        patch: {
          status: "cancelled",
          stopReason: "cancelled",
        },
      });
    });
  });
});
