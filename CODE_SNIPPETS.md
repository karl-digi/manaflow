# Code Snippets - Key Implementation Details

## 1. Keyboard Shortcut Detection (cmdk.ts)

```typescript
// apps/client/electron/main/cmdk.ts:242-262
const isCmdK = (() => {
  if (input.key.toLowerCase() !== "k") return false;
  if (input.alt || input.shift) return false;
  if (isMac) {
    // Require meta only; disallow ctrl on mac
    return Boolean(input.meta) && !input.control;
  }
  // Non-mac: require ctrl only; disallow meta
  return Boolean(input.control) && !input.meta;
})();

if (!isCmdK && !isSidebarToggle) return;

// Prevent default to avoid in-app conflicts and ensure single toggle
e.preventDefault();
targetWin.webContents.send("cmux:event:shortcut:cmd-k", {
  sourceContentsId: contents.id,
  sourceFrameRoutingId: frame.routingId,
  sourceFrameProcessId: frame.processId,
});
```

---

## 2. Command Bar State Management (CommandBar.tsx)

```typescript
// apps/client/src/components/CommandBar.tsx:283-305
export function CommandBar({
  teamSlugOrId,
  stateResetDelayMs = 30_000,
}: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openedWithShift, setOpenedWithShift] = useState(false);
  const [activePage, setActivePage] = useState<
    "root" | "teams" | "local-workspaces" | "cloud-workspaces"
  >("root");
  const [isCreatingLocalWorkspace, setIsCreatingLocalWorkspace] =
    useState(false);
  const [isCreatingCloudWorkspace, setIsCreatingCloudWorkspace] =
    useState(false);
  const [commandValue, setCommandValue] = useState<string | undefined>(
    undefined
  );
```

---

## 3. Local Workspace Creation (CommandBar.tsx)

```typescript
// apps/client/src/components/CommandBar.tsx:685-839
const createLocalWorkspace = useCallback(
  async (projectFullName: string) => {
    if (isCreatingLocalWorkspace) {
      return;
    }
    if (!socket) {
      console.warn(
        "Socket is not connected yet. Please try again momentarily."
      );
      return;
    }

    setIsCreatingLocalWorkspace(true);
    let reservedTaskId: Id<"tasks"> | null = null;
    let reservedTaskRunId: Id<"taskRuns"> | null = null;

    try {
      const repoUrl = `https://github.com/${projectFullName}.git`;
      const reservation = await reserveLocalWorkspace({
        teamSlugOrId,
        projectFullName,
        repoUrl,
      });
      if (!reservation) {
        throw new Error("Unable to reserve workspace name");
      }

      reservedTaskId = reservation.taskId;
      reservedTaskRunId = reservation.taskRunId;

      addTaskToExpand(reservation.taskId);

      await new Promise<void>((resolve) => {
        socket.emit(
          "create-local-workspace",
          {
            teamSlugOrId,
            projectFullName,
            repoUrl,
            taskId: reservation.taskId,
            taskRunId: reservation.taskRunId,
            workspaceName: reservation.workspaceName,
            descriptor: reservation.descriptor,
          },
          async (response: CreateLocalWorkspaceResponse) => {
            try {
              if (!response?.success) {
                const message =
                  response?.error ??
                  `Unable to create workspace for ${projectFullName}`;
                if (reservedTaskRunId) {
                  await failTaskRun({
                    teamSlugOrId,
                    id: reservedTaskRunId,
                    errorMessage: message,
                  }).catch(() => undefined);
                }
                console.error(message);
                return;
              }

              // Navigate to VSCode
              if (effectiveTaskId && effectiveTaskRunId) {
                void navigate({
                  to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                  params: {
                    teamSlugOrId,
                    taskId: effectiveTaskId,
                    runId: effectiveTaskRunId,
                  },
                });
              }
            } catch (callbackError) {
              console.error("Failed to create workspace", callbackError);
            } finally {
              resolve();
            }
          }
        );
      });
    } catch (error) {
      console.error("Failed to create workspace", error);
    } finally {
      setIsCreatingLocalWorkspace(false);
    }
  },
  [
    addTaskToExpand,
    failTaskRun,
    isCreatingLocalWorkspace,
    navigate,
    reserveLocalWorkspace,
    router,
    socket,
    teamSlugOrId,
  ]
);
```

---

## 4. Backend Git Clone Logic (socket-handlers.ts)

```typescript
// apps/server/src/socket-handlers.ts:950-1012
if (repoUrl) {
  if (cleanupWorkspace) {
    await cleanupWorkspace();
  }
  const cloneArgs = ["clone"];
  if (branch) {
    cloneArgs.push("--branch", branch, "--single-branch");
  }
  cloneArgs.push(repoUrl, resolvedWorkspacePath);
  try {
    await execFileAsync("git", cloneArgs, { cwd: workspaceRoot });
  } catch (error) {
    if (cleanupWorkspace) {
      await cleanupWorkspace();
    }
    const execErr = isExecError(error) ? error : null;
    const message =
      execErr?.stderr?.trim() ||
      (error instanceof Error ? error.message : "Git clone failed");
    throw new Error(
      message ? `Git clone failed: ${message}` : "Git clone failed"
    );
  }

  try {
    await execFileAsync(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      {
        cwd: resolvedWorkspacePath,
      }
    );
  } catch (error) {
    if (cleanupWorkspace) {
      await cleanupWorkspace();
    }
    throw new Error(
      error instanceof Error
        ? `Git clone failed to produce a checkout: ${error.message}`
        : "Git clone failed to produce a checkout"
    );
  }
} else {
  // No repo - create empty workspace
  try {
    await fs.mkdir(resolvedWorkspacePath, { recursive: false });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      throw new Error(
        `Workspace directory already exists: ${workspacePath}`
      );
    }
    throw error;
  }

  await execFileAsync("git", ["init"], {
    cwd: resolvedWorkspacePath,
  });
}
```

---

## 5. GitHub URL Parser (parse-github-repo-url.ts)

```typescript
// packages/shared/src/utils/parse-github-repo-url.ts
export function parseGithubRepoUrl(input: string): {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  gitUrl: string;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Try matching against different patterns
  const simpleMatch = trimmed.match(
    /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/
  );
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
  );
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i
  );

  const match = simpleMatch || httpsMatch || sshMatch;
  if (!match) {
    return null;
  }

  const [, owner, repo] = match;
  if (!owner || !repo) {
    return null;
  }

  const cleanRepo = repo.replace(/\.git$/, "");
  return {
    owner,
    repo: cleanRepo,
    fullName: `${owner}/${cleanRepo}`,
    url: `https://github.com/${owner}/${cleanRepo}`,
    gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
  };
}
```

---

## 6. Socket Schema Definitions (socket-schemas.ts)

```typescript
// packages/shared/src/socket-schemas.ts:53-98

export const CreateLocalWorkspaceSchema = z.object({
  teamSlugOrId: z.string(),
  projectFullName: z.string().optional(),
  repoUrl: z.string().optional(),
  branch: z.string().optional(),  // ← Can specify branch
  taskId: typedZid("tasks").optional(),
  taskRunId: typedZid("taskRuns").optional(),
  workspaceName: z.string().optional(),
  descriptor: z.string().optional(),
  sequence: z.number().optional(),
});

export const CreateLocalWorkspaceResponseSchema = z.object({
  success: z.boolean(),
  taskId: typedZid("tasks").optional(),
  taskRunId: typedZid("taskRuns").optional(),
  workspaceName: z.string().optional(),
  workspacePath: z.string().optional(),
  workspaceUrl: z.string().optional(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
});

export const CreateCloudWorkspaceSchema = z
  .object({
    teamSlugOrId: z.string(),
    environmentId: typedZid("environments").optional(),
    projectFullName: z.string().optional(),
    repoUrl: z.string().optional(),
    taskId: typedZid("tasks").optional(),
    taskRunId: typedZid("taskRuns").optional(),
    theme: z.enum(["dark", "light", "system"]).optional(),
  })
  .refine(
    (value) => Boolean(value.environmentId || value.projectFullName),
    "Either environmentId or projectFullName is required"
  );

export const CreateCloudWorkspaceResponseSchema = z.object({
  success: z.boolean(),
  taskId: typedZid("tasks").optional(),
  taskRunId: typedZid("taskRuns").optional(),
  workspaceUrl: z.string().optional(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
});
```

---

## 7. Local Workspace Entries in Command Bar (CommandBar.tsx)

```typescript
// apps/client/src/components/CommandBar.tsx:1928-1955
const localWorkspaceEntries = useMemo<CommandListEntry[]>(() => {
  return localWorkspaceOptions.map((option) => {
    const value = `local-workspace:${option.fullName}`;
    return {
      value,
      label: option.fullName,
      keywords: option.keywords,
      searchText: buildSearchText(option.fullName, option.keywords, [
        option.repoBaseName,
      ]),
      className: baseCommandItemClassName,
      disabled: isCreatingLocalWorkspace,
      execute: () => handleLocalWorkspaceSelect(option.fullName),
      renderContent: () => (
        <>
          <GitHubIcon className="h-4 w-4 text-neutral-500" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{option.fullName}</span>
          </div>
        </>
      ),
    };
  });
}, [
  handleLocalWorkspaceSelect,
  isCreatingLocalWorkspace,
  localWorkspaceOptions,
]);
```

---

## 8. Workspace Selection Handler (CommandBar.tsx)

```typescript
// apps/client/src/components/CommandBar.tsx:841-848
const handleLocalWorkspaceSelect = useCallback(
  (projectFullName: string) => {
    clearCommandInput();
    closeCommand();
    void createLocalWorkspace(projectFullName);
  },
  [clearCommandInput, closeCommand, createLocalWorkspace]
);
```

---

## 9. Root Command Entries with Workspace Commands (CommandBar.tsx)

```typescript
// apps/client/src/components/CommandBar.tsx:1538-1573
{
  value: "local-workspaces",
  label: "New Local Workspace",
  keywords: ["workspace", "local", "repo"],
  searchText: buildSearchText(
    "New Local Workspace",
    ["workspace", "local"],
    ["local-workspaces"]
  ),
  className: baseCommandItemClassName,
  execute: () => handleSelect("local-workspaces"),
  renderContent: () => (
    <>
      <FolderPlus className="h-4 w-4 text-neutral-500" />
      <span className="text-sm">New Local Workspace</span>
    </>
  ),
},
{
  value: "cloud-workspaces",
  label: "New Cloud Workspace",
  keywords: ["workspace", "cloud", "environment", "env"],
  searchText: buildSearchText(
    "New Cloud Workspace",
    ["workspace", "cloud", "environment"],
    ["cloud-workspaces"]
  ),
  className: baseCommandItemClassName,
  execute: () => handleSelect("cloud-workspaces"),
  renderContent: () => (
    <>
      <Server className="h-4 w-4 text-neutral-500" />
      <span className="text-sm">New Cloud Workspace</span>
    </>
  ),
},
```

---

## 10. Socket Validation in Backend (socket-handlers.ts)

```typescript
// apps/server/src/socket-handlers.ts:645-687
const parsed = CreateLocalWorkspaceSchema.safeParse(rawData);
if (!parsed.success) {
  serverLogger.error(
    "Invalid create-local-workspace payload:",
    parsed.error
  );
  callback({
    success: false,
    error: "Invalid workspace request",
  });
  return;
}

const {
  teamSlugOrId: requestedTeamSlugOrId,
  projectFullName,
  repoUrl: explicitRepoUrl,
  branch: requestedBranch,
  taskId: providedTaskId,
  taskRunId: providedTaskRunId,
  workspaceName: providedWorkspaceName,
  descriptor: providedDescriptor,
} = parsed.data;

// Validate environment check
if (projectFullName && projectFullName.startsWith("env:")) {
  callback({
    success: false,
    error: "Local workspaces cannot be created from environments.",
  });
  return;
}

// Validate repo name format
if (
  projectFullName &&
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(projectFullName)
) {
  callback({
    success: false,
    error: "Invalid repository name.",
  });
  return;
}
```

