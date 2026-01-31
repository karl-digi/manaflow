import { Link, useNavigate } from "@tanstack/react-router";
import { MessageSquarePlus, Settings, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useEffect, useState, useCallback } from "react";
import { useActor, rivetClient, getVisitorId } from "@/rivet/client";
import type { Message, ChatInfo } from "@/rivet/actors";

interface ChatEntry {
  chatId: string;
  title: string | null;
  lastMessage: string | null;
  lastMessageAt: number;
}

interface RivetChatSidebarProps {
  activeChatId?: string;
}

export function RivetChatSidebar({ activeChatId }: RivetChatSidebarProps) {
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const visitorId = getVisitorId();

  // Connect to chat list actor with full type safety
  const chatListActor = useActor({
    name: "chatList",
    key: [visitorId],
    params: { visitorId },
  });

  // Subscribe to chat list events
  chatListActor.useEvent("chatAdded", (chatId: string) => {
    setChats((prev) => {
      if (prev.some((c) => c.chatId === chatId)) return prev;
      return [
        {
          chatId,
          title: null,
          lastMessage: null,
          lastMessageAt: Date.now(),
        },
        ...prev,
      ];
    });
  });

  chatListActor.useEvent("chatRemoved", (chatId: string) => {
    setChats((prev) => prev.filter((c) => c.chatId !== chatId));
  });

  // Load initial chat list
  useEffect(() => {
    if (chatListActor.connStatus !== "connected" || !chatListActor.connection) return;

    chatListActor.connection.listChats().then(async (chatIds) => {
      const entries = await Promise.all(
        chatIds.map(async (chatId) => {
          try {
            // Use typed client for one-off calls
            const handle = rivetClient.aiChat.getOrCreate([visitorId, chatId], {
              params: { visitorId },
            });
            const info: ChatInfo = await handle.getInfo();
            const history: Message[] = await handle.getHistory();
            const lastMsg = history[history.length - 1];
            return {
              chatId,
              title: info.title,
              lastMessage: lastMsg?.content?.slice(0, 100) ?? null,
              lastMessageAt: lastMsg?.timestamp ?? info.createdAt,
            };
          } catch {
            return {
              chatId,
              title: null,
              lastMessage: null,
              lastMessageAt: Date.now(),
            };
          }
        })
      );
      setChats(entries);
    }).catch(console.error);
  }, [chatListActor.connStatus, chatListActor.connection, visitorId]);

  const handleNewChat = useCallback(async () => {
    if (!chatListActor.connection) return;

    setIsCreating(true);
    try {
      const chatId = crypto.randomUUID();
      // Create the chat actor using typed client
      rivetClient.aiChat.getOrCreate([visitorId, chatId], {
        params: { visitorId },
      });
      // Add to list
      await chatListActor.connection.addChat(chatId);
      // Navigate to new chat
      await navigate({ to: "/r/$chatId", params: { chatId } });
    } catch (error) {
      console.error("Failed to create chat:", error);
    } finally {
      setIsCreating(false);
    }
  }, [chatListActor.connection, visitorId, navigate]);

  return (
    <aside className="flex w-full flex-col border-b border-neutral-200/70 bg-white md:w-[320px] md:border-b-0 md:border-r dark:border-neutral-800/70 dark:bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200/70 px-4 py-3 dark:border-neutral-800/70">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-500" />
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Rivet Chat Demo
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/r"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={isCreating || chatListActor.connStatus !== "connected"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chat list */}
      <div className="mt-2 flex-1 overflow-y-auto pb-6">
        {chats.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {chatListActor.connStatus === "connected" ? "No chats yet" : "Connecting..."}
            </p>
            {chatListActor.connStatus === "connected" && (
              <button
                type="button"
                onClick={handleNewChat}
                disabled={isCreating}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:opacity-50"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Start a chat
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {chats.map((chat) => (
              <ChatRow
                key={chat.chatId}
                chat={chat}
                isActive={chat.chatId === activeChatId}
              />
            ))}
          </div>
        )}
      </div>

    </aside>
  );
}

function ChatRow({ chat, isActive }: { chat: ChatEntry; isActive: boolean }) {
  return (
    <Link
      to="/r/$chatId"
      params={{ chatId: chat.chatId }}
      className={clsx(
        "relative flex h-20 flex-col justify-center px-4 transition",
        isActive
          ? "bg-neutral-200/60 dark:bg-neutral-900"
          : "hover:bg-neutral-100/80 dark:hover:bg-neutral-900/60"
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 flex-shrink-0 text-violet-500" />
        <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {chat.title ?? "New Chat"}
        </span>
        <span className="ml-auto flex-shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
          {formatTimestamp(chat.lastMessageAt)}
        </span>
      </div>
      {chat.lastMessage && (
        <p className="mt-1 line-clamp-2 text-[12px] text-neutral-500 dark:text-neutral-400">
          {chat.lastMessage}
        </p>
      )}
    </Link>
  );
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }

  return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
}
