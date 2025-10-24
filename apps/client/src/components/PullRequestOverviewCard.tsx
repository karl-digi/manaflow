import { ExternalLink, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, GitMerge } from "lucide-react";
import { type StoredPullRequestInfo, type AggregatePullRequestSummary } from "@cmux/shared/pull-request-state";

interface PullRequestOverviewCardProps {
  prInfo: StoredPullRequestInfo | AggregatePullRequestSummary;
  className?: string;
}

export function PullRequestOverviewCard({ prInfo, className = "" }: PullRequestOverviewCardProps) {
  const { state, url, number } = prInfo;

  const getStatusIcon = () => {
    switch (state) {
      case "draft":
        return <GitPullRequestDraft className="w-4 h-4 text-gray-500" />;
      case "open":
        return <GitPullRequest className="w-4 h-4 text-green-500" />;
      case "merged":
        return <GitMerge className="w-4 h-4 text-purple-500" />;
      case "closed":
        return <GitPullRequestClosed className="w-4 h-4 text-red-500" />;
      default:
        return <GitPullRequest className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusBadge = () => {
    const getStatusColor = () => {
      switch (state) {
        case "draft":
          return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
        case "open":
          return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
        case "merged":
          return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
        case "closed":
          return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
        default:
          return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
      }
    };

    const getStatusText = () => {
      switch (state) {
        case "draft":
          return "Draft";
        case "open":
          return "Open";
        case "merged":
          return "Merged";
        case "closed":
          return "Closed";
        default:
          return "Unknown";
      }
    };

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor()}`}>
        {getStatusIcon()}
        <span className="ml-1">{getStatusText()}</span>
      </span>
    );
  };

  const getPrTitle = () => {
    if (number) {
      return `Pull Request #${number}`;
    }
    return "Pull Request";
  };

  if (!url) {
    return (
      <div className={`flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg ${className}`}>
        <div className="flex items-center space-x-3">
          {getStatusIcon()}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {getPrTitle()}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No URL available
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {getStatusIcon()}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {getPrTitle()}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {url.replace(/^https?:\/\//, "")}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {getStatusBadge()}
          <ExternalLink className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    </a>
  );
}