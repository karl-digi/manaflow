import { useTheme } from "@/components/theme/use-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { attachTaskLifecycleListeners } from "@/lib/socket/taskLifecycleListeners";
import {
  DEFAULT_AGENT_SELECTION,
  filterKnownAgents,
  parseStoredAgentSelection,
} from "@/lib/agentSelection";
import { postApiPlanChatMutation } from "@cmux/www-openapi-client/react-query";
import type {
  PlanAssistantResponse,
  PlanContextFile,
  PlanMessage,
} from "@cmux/www-openapi-client";
import { api } from "@cmux/convex/api";
import type { TaskAcknowledged, TaskError, TaskStarted } from "@cmux/shared";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation as useRQMutation } from "@tanstack/react-query";
import { useMutation as useConvexMutation } from "convex/react";

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  parsed?: PlanAssistantResponse;
}

interface ContextFileState extends PlanContextFile {
  preview: string;
}

const MAX_CONTEXT_FILES = 5;
const MAX_PREVIEW_LENGTH = 400;

type PlanTaskSuggestion = NonNullable<
  PlanAssistantResponse["suggestedTasks"]
>[number];

const isValidRepoFullName = (value: string): boolean =>
  /^[^/\s]+\/[^/\s]+$/.test(value.trim());

const sanitizePath = (value: string): string => value.replace(/^\/+/, "");

const createMessagePayload = (messages: ConversationMessage[]): PlanMessage[] =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

const createConversationMessage = (
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage => ({
  id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : String(Date.now()),
  role,
  content,
  createdAt: Date.now(),
});

async function fetchFileFromGitHub({
  repo,
  branch,
  path,
}: {
  repo: string;
  branch: string;
  path: string;
}): Promise<string> {
  const cleanPath = sanitizePath(path);
  const encodedPath = cleanPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(
    branch,
  )}/${encodedPath}`;
  const response = await fetch(url);

  if (response.status === 404) {
    throw new Error(`File not found at ${cleanPath}`);
  }
  if (!response.ok) {
    throw new Error(`Unexpected response ${response.status} fetching ${cleanPath}`);
  }

  return await response.text();
}

export const Route = createFileRoute("/_layout/$teamSlugOrId/plan")({
  component: PlanModeRoute,
});

function PlanModeRoute() {
  const { teamSlugOrId } = Route.useParams();
  const [repoFullName, setRepoFullName] = useState<string>("");
  const [branch, setBranch] = useState<string>("main");
  const [userInput, setUserInput] = useState<string>("");
  const [contextFilePath, setContextFilePath] = useState<string>("");
  const [contextFiles, setContextFiles] = useState<ContextFileState[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isAddingFile, setIsAddingFile] = useState<boolean>(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  const { addTaskToExpand } = useExpandTasks();
  const { socket } = useSocket();

  const planMutation = useRQMutation(postApiPlanChatMutation());
  const createTask = useConvexMutation(api.tasks.create);

  const disableSend = useMemo(
    () =>
      planMutation.isPending ||
      !isValidRepoFullName(repoFullName) ||
      userInput.trim().length === 0,
    [planMutation.isPending, repoFullName, userInput],
  );

  const handleSend = useCallback(async () => {
    const input = userInput.trim();
    if (!input) {
      return;
    }
    if (!isValidRepoFullName(repoFullName)) {
      toast.error("Enter a public GitHub repository in the format owner/repo.");
      return;
    }

    const userMessage = createConversationMessage("user", input);
    setMessages((prev) => [...prev, userMessage]);
    setUserInput("");

    try {
      const payloadMessages = createMessagePayload([...messages, userMessage]);
      const response = await planMutation.mutateAsync({
        body: {
          teamSlugOrId,
          projectFullName: repoFullName.trim(),
          branch: branch.trim() || undefined,
          messages: payloadMessages,
          contextFiles: contextFiles.map(({ path, content }) => ({ path, content })),
        },
      });

      const assistantMessage = createConversationMessage("assistant", response.message);
      if (response.parsed) {
        assistantMessage.parsed = response.parsed;
      }
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to contact Plan Mode.";
      toast.error(message);
    }
  }, [branch, contextFiles, messages, planMutation, repoFullName, teamSlugOrId, userInput]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSend();
    },
    [handleSend],
  );

  const handleKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await handleSend();
      }
    },
    [handleSend],
  );

  const handleAddContextFile = useCallback(async () => {
    if (contextFiles.length >= MAX_CONTEXT_FILES) {
      toast.error(`You can attach up to ${MAX_CONTEXT_FILES} files.`);
      return;
    }

    if (!isValidRepoFullName(repoFullName)) {
      toast.error("Enter a repository before loading context files.");
      return;
    }

    const sanitizedPath = sanitizePath(contextFilePath.trim());
    if (!sanitizedPath) {
      toast.error("Provide a relative file path to fetch.");
      return;
    }

    setIsAddingFile(true);
    try {
      const text = await fetchFileFromGitHub({
        repo: repoFullName.trim(),
        branch: branch.trim() || "main",
        path: sanitizedPath,
      });
      const preview = text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}\n…` : text;
      setContextFiles((prev) => {
        const filtered = prev.filter((file) => file.path !== sanitizedPath);
        return [...filtered, { path: sanitizedPath, content: text, preview }];
      });
      setContextFilePath("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch file content.";
      toast.error(message);
    } finally {
      setIsAddingFile(false);
    }
  }, [branch, contextFilePath, contextFiles.length, repoFullName]);

  const handleRemoveContextFile = useCallback((path: string) => {
    setContextFiles((prev) => prev.filter((file) => file.path !== path));
  }, []);

  const loadAgentSelection = useCallback((): string[] => {
    const stored = parseStoredAgentSelection(localStorage.getItem("selectedAgents"));
    if (stored.length > 0) {
      return filterKnownAgents(stored);
    }
    return DEFAULT_AGENT_SELECTION.length > 0
      ? [...DEFAULT_AGENT_SELECTION]
      : [];
  }, []);

  const handleCreateTaskFromSuggestion = useCallback(
    async (suggestion: PlanTaskSuggestion) => {
      if (!isValidRepoFullName(repoFullName)) {
        toast.error("Enter a repository before creating a task.");
        return;
      }

      const prompt = suggestion.prompt.trim();
      if (!prompt) {
        toast.error("Suggested task prompt is empty.");
        return;
      }

      const projectFullName = repoFullName.trim();
      const baseBranch = branch.trim();

      try {
        const taskId = await createTask({
          teamSlugOrId,
          text: prompt,
          projectFullName,
          baseBranch: baseBranch || undefined,
        });

        addTaskToExpand(taskId);

        const selectedAgents = loadAgentSelection();

        if (!socket) {
          toast.success("Task created. Open the dashboard to start it.");
          return;
        }

        const repoUrl = `https://github.com/${projectFullName}.git`;
        const payload = {
          repoUrl,
          ...(baseBranch ? { branch: baseBranch } : {}),
          taskDescription: prompt,
          projectFullName,
          taskId,
          selectedAgents: selectedAgents.length > 0 ? selectedAgents : undefined,
          isCloudMode: false,
          theme,
        };

        const handleAck = (response: TaskAcknowledged | TaskStarted | TaskError) => {
          if ("error" in response) {
            toast.error(`Task failed to start: ${response.error}`);
            return;
          }

          attachTaskLifecycleListeners(socket, response.taskId, {
            onFailed: (payload) => {
              toast.error(`Task failed to start: ${payload.error}`);
            },
          });
        };

        socket.emit("start-task", payload, handleAck);
        toast.success("Task dispatched to cmux agents.");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create task from suggestion.";
        toast.error(message);
      }
    },
    [addTaskToExpand, branch, createTask, loadAgentSelection, repoFullName, socket, teamSlugOrId, theme],
  );

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Plan Mode</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Collaborate with GPT-5 Pro to understand a public repository and frame actionable tasks for cmux.
        </p>
      </div>

      <Card className="border-neutral-200/70 dark:border-neutral-800/70">
        <CardHeader className="space-y-4 pb-4">
          <CardTitle className="text-lg">Repository context</CardTitle>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <label className="flex flex-1 flex-col gap-2">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                GitHub repository (owner/repo)
              </span>
              <input
                value={repoFullName}
                onChange={(event) => setRepoFullName(event.target.value)}
                placeholder="acme/project"
                className="w-full rounded-md border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-400"
              />
            </label>
            <label className="flex w-full flex-col gap-2 lg:w-48">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="w-full rounded-md border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-400"
              />
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-2">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Attach file (optional)
              </span>
              <input
                value={contextFilePath}
                onChange={(event) => setContextFilePath(event.target.value)}
                placeholder="src/index.ts"
                className="w-full rounded-md border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-400"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              onClick={handleAddContextFile}
              disabled={isAddingFile}
            >
              {isAddingFile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add context
                </>
              )}
            </Button>
          </div>
          {contextFiles.length > 0 ? (
            <div className="space-y-3">
              {contextFiles.map((file) => (
                <div
                  key={file.path}
                  className="rounded-md border border-neutral-200/80 bg-neutral-50 p-3 dark:border-neutral-800/80 dark:bg-neutral-900"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {file.path}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
                      onClick={() => handleRemoveContextFile(file.path)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <pre className="max-h-32 overflow-y-auto rounded bg-neutral-100 p-2 text-xs text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                    {file.preview}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Add up to {MAX_CONTEXT_FILES} files to ground the conversation.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200/70 bg-background dark:border-neutral-800/70">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-neutral-600 dark:text-neutral-400">
              <p className="text-base font-medium">Start planning</p>
              <p className="max-w-md text-sm">
                Describe what you want to achieve or ask questions about the repository. Plan Mode will outline a strategy and suggest tasks you can run in cmux.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onCreateTask={
                  message.role === "assistant" ? handleCreateTaskFromSuggestion : undefined
                }
              />
            ))
          )}
          {planMutation.isPending ? (
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              GPT-5 Pro is thinking…
            </div>
          ) : null}
          <div ref={scrollAnchorRef} />
        </div>
        <form onSubmit={handleSubmit} className="border-t border-neutral-200/70 bg-neutral-50 p-4 dark:border-neutral-800/70 dark:bg-neutral-900/80">
          <div className="flex flex-col gap-3">
            <textarea
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about architecture, testing gaps, or have the assistant draft a plan…"
              className="h-32 w-full resize-none rounded-md border border-neutral-300 bg-background px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-neutral-400"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                Press Enter to send · Shift+Enter for new line
              </p>
              <Button type="submit" disabled={disableSend}>
                {planMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onCreateTask,
}: {
  message: ConversationMessage;
  onCreateTask?: (task: PlanTaskSuggestion) => void;
}) {
  const isAssistant = message.role === "assistant";
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-sm",
        isAssistant
          ? "border-neutral-200 bg-neutral-50 text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          : "border-transparent bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-100",
      )}
    >
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
        <span>{isAssistant ? "Plan Mode" : "You"}</span>
        <time dateTime={new Date(message.createdAt).toISOString()}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
      {isAssistant && message.parsed ? (
        <AssistantResponseView
          parsed={message.parsed}
          raw={message.content}
          onCreateTask={onCreateTask}
        />
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      )}
    </div>
  );
}

function AssistantResponseView({
  parsed,
  raw,
  onCreateTask,
}: {
  parsed: PlanAssistantResponse;
  raw: string;
  onCreateTask?: (task: PlanTaskSuggestion) => void;
}) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch (_error) {
      return JSON.stringify(parsed, null, 2);
    }
  }, [parsed, raw]);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
          Summary
        </h3>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
          {parsed.summary}
        </p>
      </section>
      {parsed.keyPoints && parsed.keyPoints.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
            Key points
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-800 dark:text-neutral-200">
            {parsed.keyPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {parsed.suggestedTasks && parsed.suggestedTasks.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
            Suggested tasks
          </h3>
          <div className="mt-2 space-y-3">
            {parsed.suggestedTasks.map((task, index) => (
              <div
                key={index}
                className="rounded-md border border-neutral-200/80 bg-white p-3 shadow-sm dark:border-neutral-800/80 dark:bg-neutral-950"
              >
                <p className="font-medium text-neutral-900 dark:text-neutral-100">{task.title}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                  {task.prompt}
                </p>
                {onCreateTask ? (
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onCreateTask(task)}
                    >
                      Run with cmux
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {parsed.followUps && parsed.followUps.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
            Follow-up questions
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-800 dark:text-neutral-200">
            {parsed.followUps.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {parsed.references && parsed.references.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
            References
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-800 dark:text-neutral-200">
            {parsed.references.map((reference, index) => (
              <li key={index}>
                <span className="font-medium">{reference.path}</span>
                {reference.description ? ` – ${reference.description}` : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <details className="rounded-md border border-neutral-200/80 bg-neutral-50 p-3 text-neutral-700 dark:border-neutral-800/80 dark:bg-neutral-900 dark:text-neutral-300">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide">
          Raw JSON response
        </summary>
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs">
          {pretty}
        </pre>
      </details>
    </div>
  );
}
