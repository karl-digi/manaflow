export type WorkspaceTab = {
  id: string;
  title: string;
  kind: string;
};

export type WorkspacePanelNode = {
  type: "panel";
  id: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
};

export type WorkspaceSplitNode = {
  type: "split";
  id: string;
  direction: "row" | "column";
  children: WorkspaceNode[];
  sizes: number[];
};

export type WorkspaceNode = WorkspacePanelNode | WorkspaceSplitNode;

type NormalizeOptions = {
  maxEmptyPanels?: number;
};

function countWorkspaceTabs(node: WorkspaceNode): number {
  if (node.type === "panel") return node.tabs.length;
  return node.children.reduce(
    (total, child) => total + countWorkspaceTabs(child),
    0
  );
}

function normalizeSplitSizes(
  sizes: number[],
  childCount: number
): number[] {
  if (childCount <= 0) return [];
  let nextSizes = sizes;
  if (sizes.length !== childCount) {
    nextSizes = Array.from({ length: childCount }, () => 1);
  }
  const total = nextSizes.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return Array.from({ length: childCount }, () => 1 / childCount);
  }
  return nextSizes.map((value) => value / total);
}

export function normalizeWorkspace(
  root: WorkspaceNode,
  options: NormalizeOptions = {}
): WorkspaceNode {
  const maxEmptyPanels = options.maxEmptyPanels ?? 1;
  const totalTabs = countWorkspaceTabs(root);
  let emptyBudget = totalTabs === 0 ? 1 : maxEmptyPanels;

  const prune = (node: WorkspaceNode): WorkspaceNode | null => {
    if (node.type === "panel") {
      if (node.tabs.length > 0) return node;
      if (emptyBudget > 0) {
        emptyBudget -= 1;
        return node;
      }
      return null;
    }

    const hasValidSizes = node.sizes.length === node.children.length;
    const nextChildren: WorkspaceNode[] = [];
    const nextSizes: number[] = [];

    node.children.forEach((child, index) => {
      const nextChild = prune(child);
      if (nextChild) {
        nextChildren.push(nextChild);
        if (hasValidSizes) {
          nextSizes.push(node.sizes[index] ?? 0);
        }
      }
    });

    if (nextChildren.length === 0) return null;
    if (nextChildren.length === 1) return nextChildren[0] ?? null;

    const normalizedSizes = normalizeSplitSizes(
      hasValidSizes ? nextSizes : [],
      nextChildren.length
    );

    return {
      ...node,
      children: nextChildren,
      sizes: normalizedSizes,
    };
  };

  const next = prune(root);
  if (next) return next;
  return {
    type: "panel",
    id: crypto.randomUUID(),
    tabs: [],
    activeTabId: null,
  };
}

export function updateWorkspacePanel(
  node: WorkspaceNode,
  panelId: string,
  updater: (panel: WorkspacePanelNode) => WorkspacePanelNode
): WorkspaceNode {
  if (node.type === "panel") {
    if (node.id !== panelId) return node;
    return updater(node);
  }
  let changed = false;
  const nextChildren = node.children.map((child) => {
    const nextChild = updateWorkspacePanel(child, panelId, updater);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });
  if (!changed) return node;
  return { ...node, children: nextChildren };
}

export function findWorkspacePanel(
  node: WorkspaceNode,
  panelId: string
): WorkspacePanelNode | null {
  if (node.type === "panel") {
    return node.id === panelId ? node : null;
  }
  for (const child of node.children) {
    const found = findWorkspacePanel(child, panelId);
    if (found) return found;
  }
  return null;
}

export function removeWorkspaceTab(
  node: WorkspaceNode,
  tabId: string
): {
  node: WorkspaceNode;
  removedTab: WorkspaceTab | null;
  panelId: string | null;
} {
  if (node.type === "panel") {
    const index = node.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) {
      return { node, removedTab: null, panelId: null };
    }
    const removedTab = node.tabs[index];
    const nextTabs = node.tabs.filter((tab) => tab.id !== tabId);
    const nextActive =
      node.activeTabId === tabId ? nextTabs[0]?.id ?? null : node.activeTabId;
    return {
      node: { ...node, tabs: nextTabs, activeTabId: nextActive },
      removedTab,
      panelId: node.id,
    };
  }
  let removedTab: WorkspaceTab | null = null;
  let removedPanelId: string | null = null;
  const nextChildren = node.children.map((child) => {
    if (removedTab) return child;
    const result = removeWorkspaceTab(child, tabId);
    if (result.removedTab) {
      removedTab = result.removedTab;
      removedPanelId = result.panelId;
    }
    return result.node;
  });
  if (!removedTab) {
    return { node, removedTab: null, panelId: null };
  }
  return {
    node: { ...node, children: nextChildren },
    removedTab,
    panelId: removedPanelId,
  };
}

export function insertWorkspaceTab(
  node: WorkspaceNode,
  panelId: string,
  tab: WorkspaceTab,
  targetIndex?: number
): WorkspaceNode {
  return updateWorkspacePanel(node, panelId, (panel) => {
    if (panel.tabs.some((existing) => existing.id === tab.id)) {
      return panel;
    }
    const nextTabs = [...panel.tabs];
    if (typeof targetIndex === "number") {
      const clampedIndex = Math.min(
        Math.max(targetIndex, 0),
        nextTabs.length
      );
      nextTabs.splice(clampedIndex, 0, tab);
    } else {
      nextTabs.push(tab);
    }
    return {
      ...panel,
      tabs: nextTabs,
      activeTabId: tab.id,
    };
  });
}

export function findWorkspaceTab(
  node: WorkspaceNode,
  tabId: string
): WorkspaceTab | null {
  if (node.type === "panel") {
    return node.tabs.find((tab) => tab.id === tabId) ?? null;
  }
  for (const child of node.children) {
    const found = findWorkspaceTab(child, tabId);
    if (found) return found;
  }
  return null;
}

export function splitWorkspacePanel(
  node: WorkspaceNode,
  panelId: string,
  direction: "row" | "column",
  newPanel: WorkspacePanelNode,
  insertBefore: boolean
): WorkspaceNode {
  if (node.type === "panel") {
    if (node.id !== panelId) return node;
    const children = insertBefore
      ? [newPanel, node]
      : [node, newPanel];
    return {
      type: "split",
      id: crypto.randomUUID(),
      direction,
      children,
      sizes: [0.5, 0.5],
    };
  }
  let changed = false;
  const nextChildren = node.children.map((child) => {
    const nextChild = splitWorkspacePanel(
      child,
      panelId,
      direction,
      newPanel,
      insertBefore
    );
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });
  if (!changed) return node;
  return { ...node, children: nextChildren };
}
