import { MergeView } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";
import { isElectron } from "@/lib/electron";

export interface DiffMergeViewOptions {
  oldContent: string;
  newContent: string;
  extensions: Extension[];
  parent: HTMLElement;
}

export interface DiffMergeViewInstance {
  destroy: () => void;
}

function debugLog(message: string, payload?: Record<string, unknown>) {
  if (!isElectron && import.meta.env.PROD) {
    return;
  }
  if (payload) {
    console.info("[diff-merge-view]", message, payload);
  } else {
    console.info("[diff-merge-view]", message);
  }
}

export function createDiffMergeView({
  oldContent,
  newContent,
  extensions,
  parent,
}: DiffMergeViewOptions): DiffMergeViewInstance {
  const now = performance.now();

  const mergeView = new MergeView({
    a: {
      doc: oldContent,
      extensions: [...extensions],
    },
    b: {
      doc: newContent,
      extensions: [...extensions],
    },
    parent,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: {
      margin: 3,
      minSize: 6,
    },
    diffConfig: {
      scanLimit: 500,
      timeout: 1500,
    },
  });

  debugLog(`merge editor mounted after ${performance.now() - now}ms`, {
    collapseUnchanged: true,
  });

  return {
    destroy: () => {
      mergeView.destroy();
    },
  };
}