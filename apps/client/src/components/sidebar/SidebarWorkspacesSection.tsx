import { env } from "@/client-env";
import { Dropdown } from "@/components/ui/dropdown";
import clsx from "clsx";
import { Cloud, Monitor, Plus } from "lucide-react";
import { useCallback } from "react";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import type {
  SectionPreferences,
  SidebarPreferenceHandlers,
} from "./sidebar-types";

interface SidebarWorkspacesSectionProps {
  teamSlugOrId: string;
  preferences: SectionPreferences;
  onPreferencesChange: SidebarPreferenceHandlers;
}

function openCommandBarWithPage(page: string) {
  window.dispatchEvent(
    new CustomEvent("cmux:open-command-bar", { detail: { page } })
  );
}

export function SidebarWorkspacesSection({
  teamSlugOrId,
  preferences,
  onPreferencesChange,
}: SidebarWorkspacesSectionProps) {
  const handleLocalWorkspace = useCallback(() => {
    openCommandBarWithPage("local-workspaces");
  }, []);

  const handleCloudWorkspace = useCallback(() => {
    openCommandBarWithPage("cloud-workspaces");
  }, []);

  return (
    <div data-onboarding="workspaces-link">
      <SidebarSectionHeader
        title="Workspaces"
        to="/$teamSlugOrId/workspaces"
        params={{ teamSlugOrId }}
        preferences={preferences}
        onPreferencesChange={onPreferencesChange}
        trailing={
          <Dropdown.Root>
            <Dropdown.Trigger
              className={clsx(
                "flex h-5 w-5 items-center justify-center rounded-sm transition-colors",
                "text-neutral-500 dark:text-neutral-400",
                "hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
              )}
              title="New workspace"
              aria-label="New workspace"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Positioner sideOffset={4} side="bottom" align="end">
                <Dropdown.Popup className="min-w-[180px]">
                  {!env.NEXT_PUBLIC_WEB_MODE && (
                    <Dropdown.Item
                      onClick={handleLocalWorkspace}
                      className="flex items-center gap-2"
                    >
                      <Monitor className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
                      <span>Local Workspace</span>
                    </Dropdown.Item>
                  )}
                  <Dropdown.Item
                    onClick={handleCloudWorkspace}
                    className="flex items-center gap-2"
                  >
                    <Cloud className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                    <span>Cloud Workspace</span>
                  </Dropdown.Item>
                </Dropdown.Popup>
              </Dropdown.Positioner>
            </Dropdown.Portal>
          </Dropdown.Root>
        }
      />
    </div>
  );
}
