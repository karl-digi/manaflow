import { Button } from "@/components/ui/button";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import * as Dialog from "@radix-ui/react-dialog";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Circle,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Trash2,
  X,
  Search,
  GripVertical,
  Undo2,
  Square,
  CheckSquare,
} from "lucide-react";
import { useState, useCallback, useEffect, useMemo } from "react";

export const Route = createFileRoute("/_issues/$teamSlugOrId")({
  component: IssuesPage,
});

type Issue = Doc<"issues">;
type TreeNode = Issue & { children: TreeNode[] };

// Status config
const statusConfig = {
  open: { icon: Circle, color: "text-blue-500", label: "Open" },
  in_progress: { icon: Clock, color: "text-yellow-500", label: "In Progress" },
  blocked: { icon: AlertCircle, color: "text-red-500", label: "Blocked" },
  closed: { icon: CheckCircle2, color: "text-green-500", label: "Closed" },
  tombstone: { icon: Trash2, color: "text-neutral-400", label: "Deleted" },
} as const;

// Issue type config
const typeConfig = {
  bug: {
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
  feature: {
    color:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  },
  task: {
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  epic: {
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  },
  chore: {
    color:
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-400",
  },
} as const;

const issueTypes = ["task", "bug", "feature", "epic", "chore"] as const;
const issueStatuses = ["open", "in_progress", "blocked", "closed"] as const;

// =============================================================================
// Issue Detail Panel
// =============================================================================

function IssueDetailPanel({
  issue,
  open,
  onOpenChange,
  teamSlugOrId,
  onAddSubtask,
}: {
  issue: Issue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamSlugOrId: string;
  onAddSubtask: (parentId: Id<"issues">) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<Issue["issueType"]>("task");
  const [status, setStatus] = useState<Issue["status"]>("open");
  const [isSaving, setIsSaving] = useState(false);

  const updateIssue = useMutation(api.issues.updateIssue);
  const updateStatus = useMutation(api.issues.updateIssueStatus);
  const deleteIssue = useMutation(api.issues.deleteIssue);
  const undoLastEvent = useMutation(api.issues.undoLastEvent);

  // Load issue data when panel opens
  useEffect(() => {
    if (issue) {
      setTitle(issue.title);
      setDescription(issue.description ?? "");
      setIssueType(issue.issueType);
      setStatus(issue.status);
    }
  }, [issue]);

  const handleSave = async () => {
    if (!issue) return;
    setIsSaving(true);
    try {
      if (title !== issue.title || description !== (issue.description ?? "")) {
        await updateIssue({
          teamSlugOrId,
          issueId: issue._id,
          title,
          description: description,
        });
      }
      if (issueType !== issue.issueType) {
        await updateIssue({
          teamSlugOrId,
          issueId: issue._id,
          issueType,
        });
      }
      if (status !== issue.status) {
        await updateStatus({
          teamSlugOrId,
          issueId: issue._id,
          status,
        });
      }
    } catch (error) {
      console.error("Failed to save:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!issue) return;
    try {
      await deleteIssue({ teamSlugOrId, issueId: issue._id });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  const handleUndo = async () => {
    if (!issue) return;
    try {
      await undoLastEvent({ teamSlugOrId, issueId: issue._id });
    } catch (error) {
      console.error("Failed to undo:", error);
    }
  };

  if (!issue) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full max-w-lg border-l border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 overflow-y-auto">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm text-neutral-500 mb-1">
                <span className="font-mono">#{issue.shortId}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 font-medium ${typeConfig[issue.issueType]?.color ?? ""}`}
                >
                  {issue.issueType}
                </span>
              </div>
              <Dialog.Title className="sr-only">Edit Issue</Dialog.Title>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleUndo}
                className="p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title="Undo last change"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <Dialog.Close asChild>
                <button
                  className="p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Add a description..."
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Type
              </label>
              <select
                value={issueType}
                onChange={(e) =>
                  setIssueType(e.target.value as Issue["issueType"])
                }
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {issueTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Issue["status"])}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {issueStatuses.map((s) => (
                  <option key={s} value={s}>
                    {statusConfig[s].label}
                  </option>
                ))}
              </select>
            </div>

            {/* Metadata */}
            <div className="pt-4 border-t border-neutral-200 dark:border-neutral-700 text-sm text-neutral-500">
              <div className="flex justify-between py-1">
                <span>Created</span>
                <span>{new Date(issue.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Updated</span>
                <span>{new Date(issue.updatedAt).toLocaleString()}</span>
              </div>
              {issue.assignee && (
                <div className="flex justify-between py-1">
                  <span>Assignee</span>
                  <span>{issue.assignee}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
              <Button variant="outline" onClick={() => onAddSubtask(issue._id)}>
                <Plus className="w-4 h-4 mr-1" />
                Subtask
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// =============================================================================
// Create Issue Dialog
// =============================================================================

function CreateIssueDialog({
  open,
  onOpenChange,
  teamSlugOrId,
  parentIssueId,
  parentShortId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamSlugOrId: string;
  parentIssueId?: Id<"issues">;
  parentShortId?: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<Issue["issueType"]>("task");
  const [isCreating, setIsCreating] = useState(false);

  const createIssue = useMutation(api.issues.createIssue);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setIssueType("task");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsCreating(true);
    try {
      await createIssue({
        teamSlugOrId,
        title: title.trim(),
        description: description.trim() || undefined,
        issueType,
        parentIssueId,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to create issue:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-4 mb-4">
            <Dialog.Title className="text-lg font-semibold">
              {parentIssueId ? `New subtask of #${parentShortId}` : "New Issue"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title..."
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Add a description..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Type
              </label>
              <select
                value={issueType}
                onChange={(e) =>
                  setIssueType(e.target.value as Issue["issueType"])
                }
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {issueTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={isCreating || !title.trim()}>
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    Creating...
                  </>
                ) : (
                  "Create Issue"
                )}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// =============================================================================
// Bulk Actions Bar
// =============================================================================

function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onBulkStatusChange,
  onBulkDelete,
}: {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkStatusChange: (status: Issue["status"]) => void;
  onBulkDelete: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-3 shadow-lg flex items-center gap-4 z-50">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="h-4 w-px bg-neutral-700 dark:bg-neutral-300" />
      <button
        onClick={() => onBulkStatusChange("closed")}
        className="text-sm hover:underline"
      >
        Close
      </button>
      <button
        onClick={() => onBulkStatusChange("open")}
        className="text-sm hover:underline"
      >
        Reopen
      </button>
      <button
        onClick={() => onBulkStatusChange("in_progress")}
        className="text-sm hover:underline"
      >
        In Progress
      </button>
      <button
        onClick={onBulkDelete}
        className="text-sm text-red-400 dark:text-red-600 hover:underline"
      >
        Delete
      </button>
      <div className="h-4 w-px bg-neutral-700 dark:bg-neutral-300" />
      <button
        onClick={onClearSelection}
        className="text-sm text-neutral-400 dark:text-neutral-600 hover:underline"
      >
        Clear
      </button>
    </div>
  );
}

// =============================================================================
// Filters Bar
// =============================================================================

function FiltersBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: Issue["status"] | "all";
  onStatusFilterChange: (status: Issue["status"] | "all") => void;
  typeFilter: Issue["issueType"] | "all";
  onTypeFilterChange: (type: Issue["issueType"] | "all") => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search issues..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) =>
          onStatusFilterChange(e.target.value as Issue["status"] | "all")
        }
        className="px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">All statuses</option>
        {issueStatuses.map((s) => (
          <option key={s} value={s}>
            {statusConfig[s].label}
          </option>
        ))}
      </select>

      {/* Type filter */}
      <select
        value={typeFilter}
        onChange={(e) =>
          onTypeFilterChange(e.target.value as Issue["issueType"] | "all")
        }
        className="px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">All types</option>
        {issueTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

// =============================================================================
// Issue Tree Node
// =============================================================================

function IssueTreeNode({
  node,
  depth,
  expandedIds,
  toggleExpanded,
  onStatusChange,
  onSelect,
  onToggleSelect,
  selectedIds,
  onDragStart,
  onDragOver,
  onDrop,
  draggedId,
}: {
  node: TreeNode;
  depth: number;
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
  onStatusChange: (issueId: Id<"issues">, status: Issue["status"]) => void;
  onSelect: (issue: Issue) => void;
  onToggleSelect: (issue: Issue) => void;
  selectedIds: Set<string>;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, targetId: string) => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
  draggedId: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node._id);
  const isSelected = selectedIds.has(node._id);
  const isDragging = draggedId === node._id;
  const StatusIcon = statusConfig[node.status]?.icon ?? Circle;
  const statusColor = statusConfig[node.status]?.color ?? "text-neutral-500";

  return (
    <div>
      <div
        className={`group flex items-center gap-2 py-1.5 px-2 cursor-pointer transition-colors
          ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}
          ${isDragging ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        draggable
        onDragStart={() => onDragStart(node._id)}
        onDragOver={(e) => onDragOver(e, node._id)}
        onDrop={(e) => onDrop(e, node._id)}
      >
        {/* Drag handle */}
        <div className="opacity-0 group-hover:opacity-100 cursor-grab">
          <GripVertical className="w-3.5 h-3.5 text-neutral-400" />
        </div>

        {/* Selection checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(node);
          }}
          className="flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-blue-500" />
          ) : (
            <Square className="w-4 h-4 text-neutral-300 dark:text-neutral-600" />
          )}
        </button>

        {/* Expand/collapse toggle */}
        <button
          onClick={() => hasChildren && toggleExpanded(node._id)}
          className={`w-4 h-4 flex items-center justify-center ${hasChildren ? "opacity-100" : "opacity-0"}`}
          disabled={!hasChildren}
        >
          {hasChildren &&
            (isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
            ))}
        </button>

        {/* Status icon */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const statuses: Issue["status"][] = [
              "open",
              "in_progress",
              "closed",
            ];
            const currentIndex = statuses.indexOf(node.status);
            const nextStatus = statuses[(currentIndex + 1) % statuses.length];
            onStatusChange(node._id, nextStatus);
          }}
          className="flex-shrink-0"
        >
          <StatusIcon className={`w-4 h-4 ${statusColor}`} />
        </button>

        {/* Short ID */}
        <span className="text-xs font-mono text-neutral-400 w-12 flex-shrink-0">
          #{node.shortId}
        </span>

        {/* Type badge */}
        <span
          className={`text-[10px] px-1.5 py-0.5 font-medium ${typeConfig[node.issueType]?.color ?? ""}`}
        >
          {node.issueType}
        </span>

        {/* Title - clickable to open detail panel */}
        <button
          onClick={() => onSelect(node)}
          className="flex-1 truncate text-sm text-left hover:text-blue-600 dark:hover:text-blue-400"
        >
          {node.title}
        </button>

        {/* Assignee */}
        {node.assignee && (
          <span className="text-xs text-neutral-500 truncate max-w-[100px]">
            @{node.assignee.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded &&
        node.children.map((child) => (
          <IssueTreeNode
            key={child._id}
            node={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            onStatusChange={onStatusChange}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
            selectedIds={selectedIds}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            draggedId={draggedId}
          />
        ))}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

function IssuesPage() {
  const { teamSlugOrId } = Route.useParams();

  // Data
  const issueTree = useQuery(api.issues.getIssueTree, { teamSlugOrId });
  const updateStatus = useMutation(api.issues.updateIssueStatus);
  const bulkUpdateStatus = useMutation(api.issues.updateIssuesStatus);
  const bulkDelete = useMutation(api.issues.deleteIssues);

  // UI State
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<
    Id<"issues"> | undefined
  >();
  const [createParentShortId, setCreateParentShortId] = useState<
    string | undefined
  >();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Issue["status"] | "all">(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState<Issue["issueType"] | "all">(
    "all",
  );

  // Drag and drop
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Build issue map for quick lookups
  const issueMap = useMemo(() => {
    const map = new Map<string, Issue>();
    if (!issueTree) return map;
    const collect = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        map.set(node._id, node);
        collect(node.children);
      }
    };
    collect(issueTree);
    return map;
  }, [issueTree]);

  // Filter tree
  const filteredTree = useMemo(() => {
    if (!issueTree) return null;

    const filterNode = (node: TreeNode): TreeNode | null => {
      // Check if this node matches filters
      const matchesSearch =
        !searchQuery ||
        node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.shortId.includes(searchQuery);
      const matchesStatus =
        statusFilter === "all" || node.status === statusFilter;
      const matchesType = typeFilter === "all" || node.issueType === typeFilter;

      // Filter children
      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is TreeNode => n !== null);

      // Include node if it matches or has matching children
      if (
        (matchesSearch && matchesStatus && matchesType) ||
        filteredChildren.length > 0
      ) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    return issueTree.map(filterNode).filter((n): n is TreeNode => n !== null);
  }, [issueTree, searchQuery, statusFilter, typeFilter]);

  // Expand all on first load
  useEffect(() => {
    if (issueTree) {
      const allIds = new Set<string>();
      const collectIds = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.children.length > 0) {
            allIds.add(node._id);
            collectIds(node.children);
          }
        }
      };
      collectIds(issueTree);
      setExpandedIds(allIds);
    }
  }, [issueTree]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleStatusChange = useCallback(
    async (issueId: Id<"issues">, status: Issue["status"]) => {
      try {
        await updateStatus({ teamSlugOrId, issueId, status });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [teamSlugOrId, updateStatus],
  );

  const handleSelect = useCallback((issue: Issue) => {
    setSelectedIssue(issue);
    setDetailPanelOpen(true);
  }, []);

  const handleCheckboxSelect = useCallback((issue: Issue) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issue._id)) {
        next.delete(issue._id);
      } else {
        next.add(issue._id);
      }
      return next;
    });
  }, []);

  const handleBulkStatusChange = useCallback(
    async (status: Issue["status"]) => {
      try {
        await bulkUpdateStatus({
          teamSlugOrId,
          issueIds: Array.from(selectedIds) as Id<"issues">[],
          status,
        });
        setSelectedIds(new Set());
      } catch (error) {
        console.error("Failed to bulk update:", error);
      }
    },
    [teamSlugOrId, selectedIds, bulkUpdateStatus],
  );

  const handleBulkDelete = useCallback(async () => {
    try {
      await bulkDelete({
        teamSlugOrId,
        issueIds: Array.from(selectedIds) as Id<"issues">[],
      });
      setSelectedIds(new Set());
    } catch (error) {
      console.error("Failed to bulk delete:", error);
    }
  }, [teamSlugOrId, selectedIds, bulkDelete]);

  const handleAddSubtask = useCallback(
    (parentId: Id<"issues">) => {
      const parent = issueMap.get(parentId);
      setCreateParentId(parentId);
      setCreateParentShortId(parent?.shortId);
      setCreateDialogOpen(true);
      setDetailPanelOpen(false);
    },
    [issueMap],
  );

  const handleOpenCreate = useCallback(() => {
    setCreateParentId(undefined);
    setCreateParentShortId(undefined);
    setCreateDialogOpen(true);
  }, []);

  // Drag and drop handlers (reordering)
  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, _targetId: string) => {
      e.preventDefault();
    },
    [],
  );

  const handleDrop = useCallback((e: React.DragEvent, _targetId: string) => {
    e.preventDefault();
    // TODO: Implement reordering mutation
    setDraggedId(null);
  }, []);

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Issues</h1>
          <p className="text-sm text-neutral-500">Team: {teamSlugOrId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-1" />
            New Issue
          </Button>
          <Link to="/$teamSlugOrId/dashboard" params={{ teamSlugOrId }}>
            <Button variant="outline" size="sm">
              ← Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
      />

      {/* Issue tree */}
      <div className="border border-neutral-200 dark:border-neutral-700">
        {filteredTree === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <Circle className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
            <p>No issues found</p>
            <p className="text-sm">
              {searchQuery || statusFilter !== "all" || typeFilter !== "all"
                ? "Try adjusting your filters"
                : "Create your first issue"}
            </p>
          </div>
        ) : (
          <div className="py-2">
            {filteredTree.map((node) => (
              <IssueTreeNode
                key={node._id}
                node={node}
                depth={0}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
                onStatusChange={handleStatusChange}
                onSelect={handleSelect}
                onToggleSelect={handleCheckboxSelect}
                selectedIds={selectedIds}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                draggedId={draggedId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      {filteredTree && filteredTree.length > 0 && (
        <div className="mt-4 flex gap-4 text-sm text-neutral-500">
          <span>
            {countIssues(filteredTree, (i) => i.status === "open")} open
          </span>
          <span>
            {countIssues(filteredTree, (i) => i.status === "in_progress")} in
            progress
          </span>
          <span>
            {countIssues(filteredTree, (i) => i.status === "closed")} closed
          </span>
        </div>
      )}

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        onBulkStatusChange={handleBulkStatusChange}
        onBulkDelete={handleBulkDelete}
      />

      {/* Detail panel */}
      <IssueDetailPanel
        issue={selectedIssue}
        open={detailPanelOpen}
        onOpenChange={setDetailPanelOpen}
        teamSlugOrId={teamSlugOrId}
        onAddSubtask={handleAddSubtask}
      />

      {/* Create dialog */}
      <CreateIssueDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        teamSlugOrId={teamSlugOrId}
        parentIssueId={createParentId}
        parentShortId={createParentShortId}
      />
    </div>
  );
}

// Helper to count issues in tree
function countIssues(
  nodes: TreeNode[],
  predicate: (issue: Issue) => boolean,
): number {
  let count = 0;
  for (const node of nodes) {
    if (predicate(node)) count++;
    count += countIssues(node.children, predicate);
  }
  return count;
}
