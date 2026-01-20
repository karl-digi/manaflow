interface PromptConfig {
  baseBranch: string;
  mergeBase: string;
  formattedFileList: string;
  prDescription: string | null;
}

export function formatFileList(files: readonly string[]): string {
  return files.join("\n");
}

export function buildScreenshotPrompt({
  baseBranch,
  mergeBase,
  formattedFileList,
  prDescription,
}: PromptConfig): string {
  const sections = [
    "You are a release engineer evaluating repository changes to determine if UI captures (screenshots or videos) are needed before sharing updates.",
    `Repository base branch: ${baseBranch}`,
    `Merge base commit: ${mergeBase}`,
    `<pull_request_description>\n${prDescription ?? "<none provided>"}\n</pull_request_description>`,
    `<changed_files>\n${formattedFileList}\n</changed_files>`,
    [
      "Return a JSON object matching { hasUiChanges: boolean; uiChangesToScreenshotInstructions: string }.",
      "",
      "Set hasUiChanges to true when the listed files imply UI changes that should be captured.",
      'If hasUiChanges is false, set uiChangesToScreenshotInstructions to "None".',
      "",
      "If hasUiChanges is true, provide detailed instructions in uiChangesToScreenshotInstructions for capturing the UI.",
      "The capturing agent can take BOTH screenshots AND record videos - it will decide which is appropriate.",
      "",
      "Include in your instructions:",
      "- The http URLs to navigate to (explore the codebase to find the correct port and paths)",
      "- Which screens or components to capture",
      "- Any interactions needed to demonstrate the UI (clicking buttons, filling forms, etc.)",
      "",
      "The agent will automatically choose the right capture method:",
      "- Screenshots for static UI (layouts, styling, content)",
      "- Video recordings for interactive/animated UI (button clicks, form submissions, transitions, modals, loading states)",
    ].join("\n"),
  ];

  return sections.join("\n\n");
}
