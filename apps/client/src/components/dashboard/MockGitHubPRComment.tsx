import clsx from "clsx";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Rocket,
} from "lucide-react";
import { memo, useCallback, useState } from "react";

// Mock data for the preview.new bot comment
const MOCK_PREVIEW_DATA = {
  botName: "preview-bot",
  botAvatarUrl: "https://avatars.githubusercontent.com/in/932037?s=80&v=4",
  commentDate: "2 hours ago",
  prNumber: 1156,
  prTitle: "Add waitlist handling for GitLab and Bitbucket",
  repoOwner: "manaflow-ai",
  repoName: "cmux",
  commitSha: "5fc6367",
  screenshots: [
    {
      title: "Provider Selection",
      url: "/screenshots/provider-selection.png",
      description: "New provider buttons for GitLab and Bitbucket",
    },
    {
      title: "GitLab Waitlist Modal",
      url: "/screenshots/gitlab-modal.png",
      description: "Email input and join waitlist button",
    },
    {
      title: "Bitbucket Waitlist Modal",
      url: "/screenshots/bitbucket-modal.png",
      description: "Blue themed waitlist modal",
    },
    {
      title: "Success State",
      url: "/screenshots/success.png",
      description: "Green checkmark confirmation",
    },
  ],
  deployments: [
    {
      name: "cmux-client",
      url: "https://cmux-client-preview-1156.vercel.app",
      status: "ready" as const,
    },
    {
      name: "cmux-www",
      url: "https://cmux-www-preview-1156.vercel.app",
      status: "ready" as const,
    },
  ],
  workspaceUrl: "https://preview.new/w/abc123",
  devBrowserUrl: "https://preview.new/b/abc123",
  expiresIn: "59 minutes",
};

function BotAvatar({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold",
        className
      )}
    >
      <Rocket className="w-4 h-4" />
    </div>
  );
}

function StatusBadge({ status }: { status: "ready" | "building" | "error" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        status === "ready" &&
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
        status === "building" &&
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
        status === "error" &&
          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      )}
    >
      {status === "ready" && <Check className="w-3 h-3" />}
      {status === "ready" ? "Ready" : status === "building" ? "Building" : "Error"}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function ScreenshotGallery() {
  const [expanded, setExpanded] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-sm font-medium text-neutral-700 dark:text-neutral-300"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Screenshots ({MOCK_PREVIEW_DATA.screenshots.length})
      </button>
      {expanded && (
        <div className="p-3 bg-white dark:bg-neutral-900">
          {/* Screenshot preview area */}
          <div className="relative aspect-video bg-neutral-100 dark:bg-neutral-800 rounded-md mb-3 flex items-center justify-center overflow-hidden">
            <div className="text-center p-4">
              <div className="w-16 h-16 mx-auto mb-2 rounded-lg bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
                <Rocket className="w-8 h-8 text-neutral-400" />
              </div>
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                {MOCK_PREVIEW_DATA.screenshots[selectedIndex].title}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-1">
                {MOCK_PREVIEW_DATA.screenshots[selectedIndex].description}
              </p>
            </div>
          </div>
          {/* Thumbnail strip */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MOCK_PREVIEW_DATA.screenshots.map((screenshot, index) => (
              <button
                key={screenshot.title}
                onClick={() => setSelectedIndex(index)}
                className={clsx(
                  "flex-shrink-0 w-20 h-14 rounded border-2 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs text-neutral-500",
                  index === selectedIndex
                    ? "border-blue-500 dark:border-blue-400"
                    : "border-transparent hover:border-neutral-300 dark:hover:border-neutral-600"
                )}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeploymentTable() {
  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
            <th className="text-left px-3 py-2 font-medium text-neutral-600 dark:text-neutral-400">
              Deployment
            </th>
            <th className="text-left px-3 py-2 font-medium text-neutral-600 dark:text-neutral-400">
              Status
            </th>
            <th className="text-right px-3 py-2 font-medium text-neutral-600 dark:text-neutral-400">
              Preview
            </th>
          </tr>
        </thead>
        <tbody>
          {MOCK_PREVIEW_DATA.deployments.map((deployment) => (
            <tr
              key={deployment.name}
              className="border-b last:border-b-0 border-neutral-200 dark:border-neutral-700"
            >
              <td className="px-3 py-2 text-neutral-900 dark:text-neutral-100 font-mono text-xs">
                {deployment.name}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={deployment.status} />
              </td>
              <td className="px-3 py-2 text-right">
                <a
                  href={deployment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs"
                >
                  Visit
                  <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const MockGitHubPRComment = memo(function MockGitHubPRComment() {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      {/* GitHub-style comment container */}
      <div className="border border-neutral-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-900 shadow-sm">
        {/* Comment header */}
        <div className="flex items-start gap-3 px-4 py-3 bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700 rounded-t-md">
          <BotAvatar className="w-8 h-8 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                {MOCK_PREVIEW_DATA.botName}
              </span>
              <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                bot
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                commented {MOCK_PREVIEW_DATA.commentDate}
              </span>
            </div>
          </div>
        </div>

        {/* Comment body */}
        <div className="px-4 py-4 space-y-4">
          {/* Title and commit info */}
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <Rocket className="w-4 h-4 text-purple-500" />
              Preview Environment Ready
            </h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Deployed commit{" "}
              <code className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-xs font-mono">
                {MOCK_PREVIEW_DATA.commitSha}
              </code>{" "}
              for PR #{MOCK_PREVIEW_DATA.prNumber}
            </p>
          </div>

          {/* Deployments */}
          <DeploymentTable />

          {/* Screenshots */}
          <ScreenshotGallery />

          {/* Workspace links */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
            <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
              Interactive Preview
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 bg-white dark:bg-neutral-900 rounded border border-blue-200 dark:border-blue-800 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Workspace
                  </p>
                  <p className="text-sm font-mono text-neutral-900 dark:text-neutral-100 truncate">
                    {MOCK_PREVIEW_DATA.workspaceUrl}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <CopyButton text={MOCK_PREVIEW_DATA.workspaceUrl} />
                  <a
                    href={MOCK_PREVIEW_DATA.workspaceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                    title="Open workspace"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 bg-white dark:bg-neutral-900 rounded border border-blue-200 dark:border-blue-800 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Dev Browser
                  </p>
                  <p className="text-sm font-mono text-neutral-900 dark:text-neutral-100 truncate">
                    {MOCK_PREVIEW_DATA.devBrowserUrl}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <CopyButton text={MOCK_PREVIEW_DATA.devBrowserUrl} />
                  <a
                    href={MOCK_PREVIEW_DATA.devBrowserUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                    title="Open dev browser"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
              Links expire in {MOCK_PREVIEW_DATA.expiresIn}
            </p>
          </div>

          {/* Reactions bar (GitHub style) */}
          <div className="flex items-center gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
            <button className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400">
              <span role="img" aria-label="thumbs up">
                👍
              </span>{" "}
              3
            </button>
            <button className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400">
              <span role="img" aria-label="rocket">
                🚀
              </span>{" "}
              2
            </button>
            <button className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400">
              <span role="img" aria-label="eyes">
                👀
              </span>{" "}
              1
            </button>
            <button className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-dashed border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default MockGitHubPRComment;
