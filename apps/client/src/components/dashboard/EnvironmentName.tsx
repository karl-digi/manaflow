import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { useEffect, useState } from "react";

interface EnvironmentNameProps {
  environmentId: Id<"environments">;
  teamSlugOrId: string;
}

export function EnvironmentName({
  environmentId,
  teamSlugOrId,
}: EnvironmentNameProps) {
  const environment = useQuery(
    api.environments.get,
    isFakeConvexId(environmentId)
      ? "skip"
      : { teamSlugOrId, id: environmentId }
  );
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (environment) {
      // Trigger fade-in after mount
      setIsVisible(true);
    }
  }, [environment]);

  if (!environment) {
    return null;
  }

  return (
    <span
      className="block max-w-full shrink truncate whitespace-nowrap text-right text-[11px] text-neutral-400 dark:text-neutral-500 transition-opacity duration-200"
      title={environment.name}
      style={{ opacity: isVisible ? 1 : 0 }}
    >
      {environment.name}
    </span>
  );
}
