import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useActor, getVisitorId } from "@/rivet/client";
import { useAction, useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Message, ToolCall } from "@/rivet/actors";

export const Route = createFileRoute("/_layout/r/$chatId")({
  component: RivetChatView,
});

function RivetChatView() {
  const { chatId } = Route.useParams();
  const visitorId = getVisitorId();

  // Get user's first team for sandbox spawning
  const teamMemberships = useQuery(api.teams.listTeamMemberships);
  const teamId = teamMemberships?.[0]?.teamId ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<"idle" | "spawning" | "ready" | "error">("idle");

  // Convex action to spawn sandbox
  const spawnRivetSandbox = useAction(api.acp.spawnRivetSandbox);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Connect to chat actor with full type safety
  const chatActor = useActor({
    name: "aiChat",
    key: [visitorId, chatId],
    params: { visitorId },
  });

  const isConnected = chatActor.connStatus === "connected";

  // Subscribe to events with type safety
  chatActor.useEvent("history", (msgs: Message[]) => {
    setMessages(msgs);
  });

  chatActor.useEvent("newMessage", (msg: Message) => {
    // Only add user messages directly - assistant messages come via streaming
    if (msg.role === "user") {
      setMessages((prev) => [...prev, msg]);
    }
  });

  chatActor.useEvent("titleUpdated", (newTitle: string) => {
    setTitle(newTitle);
  });

  // Streaming events
  chatActor.useEvent("messageStart", (msg: Message) => {
    setStreamingMessage(msg);
  });

  chatActor.useEvent("messageStream", (data: { id: string; delta: string; content: string; toolCalls?: ToolCall[] }) => {
    setStreamingMessage((prev) => prev ? { ...prev, content: data.content, toolCalls: data.toolCalls } : null);
  });

  chatActor.useEvent("messageComplete", (msg: Message) => {
    setStreamingMessage(null);
    setMessages((prev) => [...prev, msg]);
  });

  // Load initial data and spawn sandbox when connected
  useEffect(() => {
    if (!isConnected || !chatActor.connection || !teamId) return;

    const initialize = async () => {
      // Get initial info and history first
      const info = await chatActor.connection?.getInfo();
      if (info) setTitle(info.title);

      const msgs = await chatActor.connection?.getHistory();
      if (msgs) setMessages(msgs);

      // Spawn a sandbox via Convex (uses user's configured provider)
      setSandboxStatus("spawning");
      try {
        const { sandboxUrl } = await spawnRivetSandbox({ teamId });
        console.log("[RivetChat] Spawned sandbox:", sandboxUrl);

        // Configure the Rivet actor with the spawned sandbox
        await chatActor.connection?.configure({
          sandboxUrl,
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
        });
        setSandboxStatus("ready");
        console.log("[RivetChat] Configured with sandbox:", sandboxUrl);
      } catch (error) {
        console.error("[RivetChat] Failed to spawn/configure sandbox:", error);
        setSandboxStatus("error");
      }
    };

    initialize().catch(console.error);
  }, [isConnected, chatActor.connection, teamId, spawnRivetSandbox]);

  // Auto-scroll on new messages or streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !chatActor.connection) return;

    setIsSending(true);
    setText("");

    try {
      // Fully typed - send returns Message
      await chatActor.connection.send(trimmed);
    } catch (error) {
      console.error("Failed to send message:", error);
      setText(trimmed); // Restore text on error
    } finally {
      setIsSending(false);
    }
  }, [text, chatActor.connection]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !isSending) {
        handleSend();
      }
    }
  };

  // Allow sending as soon as connected - backend will queue if not configured yet
  const canSend = text.trim().length > 0 && !isSending && isConnected;

  return (
    <div className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden bg-white dark:bg-[#191919]">
      {/* Header */}
      <div className="border-b border-neutral-200/40 dark:border-neutral-800/40">
        <div className="mx-auto max-w-3xl px-6 py-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {title ?? "New Chat"}
            </span>
            {!isConnected && (
              <span className="ml-2 text-[11px] text-neutral-400">
                Connecting...
              </span>
            )}
            {isConnected && sandboxStatus === "spawning" && (
              <span className="ml-2 text-[11px] text-amber-500">
                Starting sandbox...
              </span>
            )}
            {sandboxStatus === "error" && (
              <span className="ml-2 text-[11px] text-red-500">
                Sandbox error
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
        <div
          className="flex-1 overflow-y-auto"
          style={{ overflowAnchor: "none" }}
        >
          <div className="flex flex-col gap-1 pb-36">
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
              <div className="flex flex-col gap-4">
                {messages.length === 0 && isConnected && (
                  <div className="py-12 text-center">
                    <p className="text-sm text-neutral-400 dark:text-neutral-500">
                      Send a message to start the conversation
                    </p>
                  </div>
                )}
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {streamingMessage && (
                  <MessageBubble key={streamingMessage.id} message={streamingMessage} isStreaming />
                )}
              </div>
            </div>
          </div>
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {/* Composer */}
        <div className="absolute inset-x-0 bottom-0 pointer-events-none">
          <div className="bg-white dark:bg-[#191919] pointer-events-auto">
            <div className="mx-auto max-w-[52rem] px-6 pb-4">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 pl-3 pt-3 pr-2 pb-2 dark:border-neutral-700 dark:bg-neutral-800">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  placeholder="Type a message..."
                  disabled={!isConnected}
                  className="w-full resize-none bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none disabled:opacity-50 dark:text-neutral-100 dark:placeholder:text-neutral-500 max-h-32 overflow-y-auto"
                />
                <div className="flex items-center justify-end mt-1">
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!canSend}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500 text-white transition hover:bg-violet-600 disabled:opacity-40"
                  >
                    {isSending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallBubble({ toolCall }: { toolCall: ToolCall }) {
  const statusColors = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="my-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className="flex items-center gap-2 mb-2">
        <span className={clsx("px-2 py-0.5 rounded text-xs font-medium", statusColors[toolCall.status])}>
          {toolCall.tool}
        </span>
        <span className="text-[10px] text-neutral-400">
          {toolCall.status}
        </span>
      </div>
      {toolCall.args && Object.keys(toolCall.args).length > 0 && (
        <pre className="text-xs text-neutral-600 dark:text-neutral-400 overflow-x-auto">
          {JSON.stringify(toolCall.args, null, 2)}
        </pre>
      )}
      {toolCall.result !== undefined && (
        <div className="mt-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Result</span>
          <pre className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 overflow-x-auto">
            {typeof toolCall.result === "string" ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </div>
      )}
      {toolCall.error && (
        <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-900">
          <span className="text-[10px] text-red-500 uppercase tracking-wider">Error</span>
          <pre className="text-xs text-red-600 dark:text-red-400 mt-1">{toolCall.error}</pre>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const isUser = message.role === "user";

  return (
    <div
      className={clsx(
        "flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start"
      )}
    >
      {/* Tool calls (only for assistant messages) */}
      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full max-w-[90%]">
          {message.toolCalls.map((tc) => (
            <ToolCallBubble key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
      {/* Message content */}
      {(message.content || isStreaming) && (
        <div
          className={clsx(
            "max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap",
            isUser
              ? "rounded-lg bg-neutral-100 px-4 py-3 dark:bg-neutral-800"
              : "text-neutral-900 dark:text-neutral-100"
          )}
        >
          {message.content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-violet-500 animate-pulse" />
          )}
        </div>
      )}
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
        {new Date(message.timestamp).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}
