import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSocket } from "@/contexts/socket/use-socket";
import { toast } from "sonner";
import { Monitor } from "lucide-react";

interface DashboardStartWorkspaceButtonProps {
  selectedEnvironment?: string;
  disabledReason?: string;
}

export function DashboardStartWorkspaceButton({
  selectedEnvironment,
  disabledReason,
}: DashboardStartWorkspaceButtonProps) {
  const { socket } = useSocket();

  const isDisabled = !selectedEnvironment || !!disabledReason;

  const handleStartWorkspace = async () => {
    if (!selectedEnvironment || !socket) {
      return;
    }

    try {
      // Extract environment ID from the selected value (format: "env:environmentId")
      const environmentId = selectedEnvironment.replace(/^env:/, "") as any;
      
      // Emit workspace-start event to server
      socket.emit("workspace-start", { environmentId }, (response: any) => {
        if (response.success) {
          toast.success("Workspace started successfully");
          // You could navigate to the workspace or task detail here if needed
        } else {
          toast.error(`Failed to start workspace: ${response.error}`);
        }
      });
    } catch (error) {
      console.error("Error starting workspace:", error);
      toast.error("Failed to start workspace");
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          <Button
            size="sm"
            variant="outline"
            className="!h-7 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900"
            onClick={handleStartWorkspace}
            disabled={isDisabled}
          >
            <Monitor className="w-3 h-3 mr-1" />
            Start workspace
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="flex items-center gap-1 bg-black text-white border-black [&>*:last-child]:bg-black [&>*:last-child]:fill-black"
      >
        {disabledReason ? (
          <span className="text-xs">{disabledReason}</span>
        ) : (
          <span className="text-xs">Start workspace without task description</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}