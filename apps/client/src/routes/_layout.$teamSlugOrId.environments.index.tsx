import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { clearPendingEnvironment, usePendingEnvironment } from "@/lib/pendingEnvironmentsStore";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Calendar, Clock, Eye, GitBranch, Play, Plus, Server } from "lucide-react";

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
  const navigate = useNavigate();

  const { data: environments } = useSuspenseQuery(
    convexQuery(api.environments.list, {
      teamSlugOrId,
    })
  );

  const pendingEnvironment = usePendingEnvironment(teamSlugOrId);
  const pendingStepLabel = pendingEnvironment
    ? pendingEnvironment.step === "configure"
      ? "Configure environment"
      : "Select repositories"
    : null;
  const pendingUpdatedLabel = pendingEnvironment
    ? formatDistanceToNow(pendingEnvironment.updatedAt, {
        addSuffix: true,
      })
    : null;

  const handleResumePending = () => {
    if (!pendingEnvironment) {
      return;
    }
    void navigate({
      to: "/$teamSlugOrId/environments/new",
      params: { teamSlugOrId },
      search: {
        step: pendingEnvironment.step,
        selectedRepos:
          pendingEnvironment.selectedRepos.length > 0
            ? pendingEnvironment.selectedRepos
            : undefined,
        connectionLogin: pendingEnvironment.connectionLogin ?? undefined,
        repoSearch: pendingEnvironment.repoSearch ?? undefined,
        instanceId: pendingEnvironment.instanceId,
        snapshotId: pendingEnvironment.snapshotId,
      },
    });
  };

  const handleDiscardPending = () => {
    clearPendingEnvironment(teamSlugOrId);
  };

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
        {pendingEnvironment ? (
          <div className="mb-6">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/70 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Pending environment
                  </div>
                  <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                    {pendingEnvironment.envName && pendingEnvironment.envName.trim().length > 0
                      ? pendingEnvironment.envName
                      : "Untitled environment"}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                    {pendingUpdatedLabel ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Updated {pendingUpdatedLabel}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      {pendingEnvironment.selectedRepos.length} repo
                      {pendingEnvironment.selectedRepos.length === 1 ? "" : "s"}
                    </span>
                    {pendingStepLabel ? (
                      <span className="inline-flex items-center gap-1">
                        Step: {pendingStepLabel}
                      </span>
                    ) : null}
                  </div>
                  {pendingEnvironment.selectedRepos.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {pendingEnvironment.selectedRepos.slice(0, 3).map((repo) => (
                        <span
                          key={repo}
                          className="inline-flex items-center rounded-full bg-white dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300"
                        >
                          {repo.split("/")[1] || repo}
                        </span>
                      ))}
                      {pendingEnvironment.selectedRepos.length > 3 ? (
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-neutral-900 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300">
                          +{pendingEnvironment.selectedRepos.length - 3}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2 md:flex-row">
                  <button
                    type="button"
                    onClick={handleDiscardPending}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleResumePending}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 transition-colors"
                  >
                    Resume
                  </button>
                </div>
              </div>
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
        ) : null}
        {!pendingEnvironment && (!environments || environments.length === 0) ? (
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
        ) : null}
      </div>
    </FloatingPane>
  );
}
