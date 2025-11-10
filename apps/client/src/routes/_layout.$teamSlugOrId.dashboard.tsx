import { TaskCreationPanel } from "@/components/dashboard/TaskCreationPanel";
import { TaskList } from "@/components/dashboard/TaskList";
import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/$teamSlugOrId/dashboard")({
  component: DashboardComponent,
});

function DashboardComponent() {
  const { teamSlugOrId } = Route.useParams();
  const searchParams = Route.useSearch() as { environmentId?: string };

  return (
    <FloatingPane header={<TitleBar title="cmux" />}>
      <div className="flex flex-col grow overflow-y-auto">
        <div className="flex-1 flex justify-center px-4 pt-60 pb-4">
          <div className="w-full max-w-4xl min-w-0 space-y-6">
            <TaskCreationPanel
              teamSlugOrId={teamSlugOrId}
              preselectedEnvironmentId={searchParams?.environmentId}
            />
            <TaskList teamSlugOrId={teamSlugOrId} />
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}
