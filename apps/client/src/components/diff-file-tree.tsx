import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileEdit,
  FileMinus,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useMemo, useState, memo } from "react";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  status?: ReplaceDiffEntry["status"];
  additions?: number;
  deletions?: number;
  children?: FileNode[];
  isExpanded?: boolean;
}

function buildFileTree(diffs: ReplaceDiffEntry[]): FileNode[] {
  const root: Record<string, FileNode> = {};

  for (const diff of diffs) {
    const parts = diff.filePath.split("/");
    let currentLevel = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!currentLevel[part]) {
        currentLevel[part] = {
          name: part,
          path: currentPath,
          type: isLastPart ? "file" : "directory",
          children: isLastPart ? undefined : [],
        };

        if (isLastPart) {
          currentLevel[part].status = diff.status;
          currentLevel[part].additions = diff.additions;
          currentLevel[part].deletions = diff.deletions;
        }
      }

      if (!isLastPart && currentLevel[part].children) {
        const childrenRecord: Record<string, FileNode> = {};
        for (const child of currentLevel[part].children!) {
          childrenRecord[child.name] = child;
        }
        currentLevel = childrenRecord;
      }
    }
  }

  const sortNodes = (nodes: FileNode[]): FileNode[] => {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  };

  const convertToArray = (record: Record<string, FileNode>): FileNode[] => {
    const nodes = Object.values(record);
    for (const node of nodes) {
      if (node.children) {
        const childrenRecord: Record<string, FileNode> = {};
        for (const child of node.children) {
          childrenRecord[child.name] = child;
        }
        node.children = sortNodes(convertToArray(childrenRecord));
      }
    }
    return sortNodes(nodes);
  };

  return convertToArray(root);
}

function getStatusColor(status?: ReplaceDiffEntry["status"]) {
  switch (status) {
    case "added":
      return "text-green-600 dark:text-green-400";
    case "deleted":
      return "text-red-600 dark:text-red-400";
    case "modified":
      return "text-yellow-600 dark:text-yellow-400";
    case "renamed":
      return "text-blue-600 dark:text-blue-400";
    default:
      return "text-neutral-600 dark:text-neutral-400";
  }
}

function getFileIcon(status?: ReplaceDiffEntry["status"]) {
  const iconClass = "w-3.5 h-3.5 flex-shrink-0";
  switch (status) {
    case "added":
      return <FilePlus className={iconClass} />;
    case "deleted":
      return <FileMinus className={iconClass} />;
    case "modified":
      return <FileEdit className={iconClass} />;
    case "renamed":
      return <FileCode className={iconClass} />;
    default:
      return <FileText className={iconClass} />;
  }
}

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}

const FileTreeNode = memo(function FileTreeNode({
  node,
  level,
  selectedPath,
  expandedPaths,
  onToggleDirectory,
  onSelectFile,
}: FileTreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  const handleClick = () => {
    if (node.type === "directory") {
      onToggleDirectory(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors text-xs",
          isSelected && "bg-neutral-200 dark:bg-neutral-800"
        )}
        style={{ paddingLeft: `${8 + level * 12}px` }}
      >
        {node.type === "directory" ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400 flex-shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <div style={{ width: "12px" }} className="flex-shrink-0" />
            <div className={getStatusColor(node.status)}>
              {getFileIcon(node.status)}
            </div>
          </>
        )}
        <span
          className={cn(
            "truncate font-mono",
            node.type === "directory"
              ? "text-neutral-700 dark:text-neutral-300"
              : getStatusColor(node.status)
          )}
        >
          {node.name}
        </span>
        {node.type === "file" && (
          <div className="flex items-center gap-1.5 ml-auto text-[10px]">
            {node.additions !== undefined && node.additions > 0 && (
              <span className="text-green-600 dark:text-green-400 font-medium select-none">
                +{node.additions}
              </span>
            )}
            {node.deletions !== undefined && node.deletions > 0 && (
              <span className="text-red-600 dark:text-red-400 font-medium select-none">
                -{node.deletions}
              </span>
            )}
          </div>
        )}
      </button>
      {node.type === "directory" && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export interface DiffFileTreeProps {
  diffs: ReplaceDiffEntry[];
  selectedFilePath: string | null;
  onFileSelect: (path: string) => void;
  className?: string;
}

export function DiffFileTree({
  diffs,
  selectedFilePath,
  onFileSelect,
  className,
}: DiffFileTreeProps) {
  const fileTree = useMemo(() => buildFileTree(diffs), [diffs]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const paths = new Set<string>();

    // Auto-expand directories with only one child
    const autoExpandSingleChildDirs = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.type === "directory" && node.children) {
          if (node.children.length === 1) {
            paths.add(node.path);
          }
          autoExpandSingleChildDirs(node.children);
        }
      }
    };

    autoExpandSingleChildDirs(fileTree);
    return paths;
  });

  const handleToggleDirectory = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const diff of diffs) {
      additions += diff.additions;
      deletions += diff.deletions;
    }
    return { additions, deletions };
  }, [diffs]);

  if (fileTree.length === 0) {
    return (
      <div className={cn("bg-neutral-50 dark:bg-neutral-900/50", className)}>
        <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 select-none">
          No files changed
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-white dark:bg-neutral-900", className)}>
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 select-none">
          Files changed ({diffs.length})
        </span>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-green-600 dark:text-green-400 font-medium select-none">
            +{totalStats.additions}
          </span>
          <span className="text-red-600 dark:text-red-400 font-medium select-none">
            -{totalStats.deletions}
          </span>
        </div>
      </div>
      <div className="overflow-y-auto">
        {fileTree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            level={0}
            selectedPath={selectedFilePath}
            expandedPaths={expandedPaths}
            onToggleDirectory={handleToggleDirectory}
            onSelectFile={onFileSelect}
          />
        ))}
      </div>
    </div>
  );
}
