import { useTheme } from "@/components/theme/use-theme";
import {
  MonacoGitDiffViewer as SharedMonacoGitDiffViewer,
} from "@cmux/shared/components/diff-viewer";
import type { GitDiffViewerProps } from "@cmux/shared/components/diff-viewer";

export type { GitDiffViewerProps } from "@cmux/shared/components/diff-viewer";

export function MonacoGitDiffViewer(props: GitDiffViewerProps) {
  const { theme } = useTheme();
  const resolvedTheme = theme === "dark" ? "dark" : "light";

  return <SharedMonacoGitDiffViewer {...props} theme={resolvedTheme} />;
}
