import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import {
  clearPendingEnvironment,
  usePendingEnvironment,
} from "@/lib/pendingEnvironmentsStore";
import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  Calendar,
  Eye,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Server,
} from "lucide-react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/environments/")({
  loader: async ({ params }) => {
    await convexQueryClient.queryClient.ensureQueryData(
      convexQuery(api.environments.list, {
        teamSlugOrId: params.teamSlugOrId,
      })
    );
  },
  component: EnvironmentsListPage,
});

function EnvironmentsListPage() {
  const { teamSlugOrId } = Route.useParams();

  const { data: environments } = useSuspenseQuery(
    convexQuery(api.environments.list, {
      teamSlugOrId,
    })
  );

  const pending = usePendingEnvironment(teamSlugOrId);
  const pendingHasMeaningfulProgress = Boolean(
    pending &&
      (
        pending.instanceId ||
        pending.selectedRepos.length > 0 ||
        (pending.envName && pending.envName.trim().length > 0) ||
        (pending.maintenanceScript && pending.maintenanceScript.trim().length > 0) ||
        (pending.devScript && pending.devScript.trim().length > 0) ||
        (pending.exposedPorts && pending.exposedPorts.trim().length > 0) ||
        (pending.envVars &&
          pending.envVars.some(
            (item) =>
              item.name.trim().length > 0 || item.value.trim().length > 0
          ))
      )
  );

  const pendingEnvironmentName = pending?.envName?.trim().length
    ? pending.envName.trim()
    : "Untitled environment";

  const pendingReposPreview = pending?.selectedRepos?.slice(0, 3) ?? [];
  const pendingReposOverflow = pending
    ? Math.max(pending.selectedRepos.length - pendingReposPreview.length, 0)
    : 0;

  const resumeSearch = pending
    ? {
        step: pending.step,
        selectedRepos: pending.selectedRepos,
        connectionLogin: pending.connectionLogin ?? undefined,
        repoSearch: pending.repoSearch ?? undefined,
        instanceId: pending.instanceId ?? undefined,
        snapshotId: pending.snapshotId ?? undefined,
      }
    : undefined;

  const pendingUpdatedAt = pending
    ? formatDistanceToNow(new Date(pending.updatedAt), {
        addSuffix: true,
      })
    : null;

  const pendingVscodeUrl = pending
    ? pending.vscodeUrl ??
      (pending.instanceId
        ? `https://port-39378-${pending.instanceId.replace(/_/g, "-")}.http.cloud.morph.so/?folder=/root/workspace`
        : undefined)
    : undefined;

  return (
    <FloatingPane header={<TitleBar title="Environments" />}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Your Environments
          </h2>
          <Link
            to="/$teamSlugOrId/environments/new"
            params={{ teamSlugOrId }}
            search={{
              step: undefined,
              selectedRepos: undefined,
              connectionLogin: undefined,
              repoSearch: undefined,
              instanceId: undefined,
              snapshotId: undefined,
            }}
            className="inline-flex items-center gap-2 rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Environment
          </Link>
        </div>
        {pendingHasMeaningfulProgress && pending ? (
          <div className="mb-6 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  <Loader2 className="h-4 w-4 animate-spin text-neutral-500 dark:text-neutral-400" />
                  Pending environment
                </div>
                {pendingUpdatedAt ? (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
                    Updated {pendingUpdatedAt}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => clearPendingEnvironment(teamSlugOrId)}
                className="text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
              >
                Discard
              </button>
            </div>
            <div className="mt-3 space-y-1">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {pendingEnvironmentName}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                {pending.step === "configure"
                  ? "Configuration in progress"
                  : "Repository selection in progress"}
              </p>
            </div>
            {pendingReposPreview.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-3">
                {pendingReposPreview.map((repo) => (
                  <span
                    key={repo}
                    className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300"
                  >
                    {repo.split("/")[1] ?? repo}
                  </span>
                ))}
                {pendingReposOverflow > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300">
                    +{pendingReposOverflow}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 mt-4">
              <Link
                to="/$teamSlugOrId/environments/new"
                params={{ teamSlugOrId }}
                search={resumeSearch ?? {
                  step: "select",
                  selectedRepos: undefined,
                  connectionLogin: undefined,
                  repoSearch: undefined,
                  instanceId: undefined,
                  snapshotId: undefined,
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors"
              >
                Resume setup
              </Link>
              {pendingVscodeUrl ? (
                <a
                  href={pendingVscodeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                >
                  Open VS Code
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        {environments && environments.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {environments.map((env) => (
              <div
                key={env._id}
                className="group relative rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 hover:shadow-md transition-shadow flex flex-col"
              >
                <div className="flex flex-col grow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Server className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                      <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                        {env.name}
                      </h3>
                    </div>
                  </div>

                  {env.description && (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3 line-clamp-2">
                      {env.description}
                    </p>
                  )}

                  {env.selectedRepos && env.selectedRepos.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-500 mb-1">
                        <GitBranch className="w-3 h-3" />
                        Repositories
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {env.selectedRepos.slice(0, 3).map((repo) => (
                          <span
                            key={repo}
                            className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300"
                          >
                            {repo.split("/")[1] || repo}
                          </span>
                        ))}
                        {env.selectedRepos.length > 3 && (
                          <span className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300">
                            +{env.selectedRepos.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDistanceToNow(new Date(env.createdAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-900">
                  <div className="text-xs text-neutral-500 dark:text-neutral-500 mb-3">
                    Snapshot ID: {env.morphSnapshotId}
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to="/$teamSlugOrId/environments/$environmentId"
                      params={{ teamSlugOrId, environmentId: env._id }}
                      search={{
                        step: undefined,
                        selectedRepos: undefined,
                        connectionLogin: undefined,
                        repoSearch: undefined,
                        instanceId: undefined,
                        snapshotId: env.morphSnapshotId ?? undefined,
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </Link>
                    <Link
                      to="/$teamSlugOrId/dashboard"
                      params={{ teamSlugOrId }}
                      search={{ environmentId: env._id }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                      Launch
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : pendingHasMeaningfulProgress ? (
          <div className="rounded-lg border border-dashed border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-sm text-neutral-600 dark:text-neutral-400">
            Finish configuring your pending environment to see it in your saved list.
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
              <Server className="w-8 h-8 text-neutral-400 dark:text-neutral-600" />
            </div>
            <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              No environments yet
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 max-w-md mx-auto">
              Create your first environment to save and reuse development
              configurations across your team.
            </p>
            <Link
              to="/$teamSlugOrId/environments/new"
              params={{ teamSlugOrId }}
              search={{
                step: undefined,
                selectedRepos: undefined,
                connectionLogin: undefined,
                repoSearch: undefined,
                instanceId: undefined,
                snapshotId: undefined,
              }}
              className="inline-flex items-center gap-2 rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Plus className="w-4 h-4" />
              Create First Environment
            </Link>
          </div>
        )}
      </div>
    </FloatingPane>
  );
}
