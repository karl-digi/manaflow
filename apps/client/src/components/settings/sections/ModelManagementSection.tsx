import { AgentLogo } from "@/components/icons/agent-logos";
import { SettingSection } from "@/components/settings/SettingSection";
import { api } from "@cmux/convex/api";
import type { AgentVendor } from "@cmux/shared/agent-catalog";
import { Switch } from "@heroui/react";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAction, useConvex } from "convex/react";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// Model entry from Convex database
interface ModelEntry {
  _id: string;
  name: string;
  displayName: string;
  vendor: string;
  tier: "free" | "paid";
  enabled: boolean;
  hiddenForTeam: boolean;
  tags?: string[];
  requiredApiKeys: string[];
  disabled?: boolean;
  sortOrder: number;
}

interface ModelManagementSectionProps {
  teamSlugOrId: string;
}

const VENDOR_DISPLAY_NAMES: Record<AgentVendor, string> = {
  anthropic: "Claude",
  openai: "OpenAI / Codex",
  google: "Gemini",
  opencode: "OpenCode",
  qwen: "Qwen",
  cursor: "Cursor",
  amp: "Amp",
  xai: "xAI",
  openrouter: "OpenRouter",
};

export function ModelManagementSection({
  teamSlugOrId,
}: ModelManagementSectionProps) {
  const convex = useConvex();
  const [searchQuery, setSearchQuery] = useState("");
  const [showHiddenOnly, setShowHiddenOnly] = useState(false);

  // Query all models from Convex database (includes disabled and discovered models)
  const { data: convexModels, refetch: refetchModels, isLoading } = useQuery(
    convexQuery(api.models.listAll, { teamSlugOrId })
  );

  // Auto-seed models if none exist (self-healing mechanism)
  const ensureModelsSeeded = useAction(api.modelDiscovery.ensureModelsSeeded);
  const hasTriedSeeding = useRef(false);
  useEffect(() => {
    // Only try seeding once per component mount
    if (hasTriedSeeding.current) return;
    // Wait for query to complete
    if (isLoading) return;
    // If we have models, no need to seed
    if (convexModels && convexModels.length > 0) return;

    // No models found - trigger seeding
    hasTriedSeeding.current = true;
    console.log("[ModelManagementSection] No models found, triggering auto-seed...");
    ensureModelsSeeded({ teamSlugOrId })
      .then((result) => {
        if (result.seeded) {
          console.log(`[ModelManagementSection] Auto-seeded ${result.count} models`);
          void refetchModels();
        }
      })
      .catch((error) => {
        console.error("[ModelManagementSection] Auto-seed failed:", error);
      });
  }, [convexModels, isLoading, ensureModelsSeeded, teamSlugOrId, refetchModels]);

  // Query API keys to determine model availability
  const { data: apiKeys } = useQuery(
    convexQuery(api.apiKeys.getAll, { teamSlugOrId })
  );

  // Build a Set of configured API key env vars for efficient lookup
  const configuredApiKeys = useMemo(() => {
    if (!apiKeys) return new Set<string>();
    return new Set(apiKeys.map((k) => k.envVar));
  }, [apiKeys]);

  // Check if a model is available (required API key is configured)
  const isModelAvailable = useCallback(
    (entry: ModelEntry) => {
      // Free models are always available
      if (entry.tier === "free") return true;
      // If no API keys required, it's available
      if (!entry.requiredApiKeys || entry.requiredApiKeys.length === 0) return true;
      // Check if at least ONE of the required API keys is configured
      return entry.requiredApiKeys.some((requiredKey) =>
        configuredApiKeys.has(requiredKey)
      );
    },
    [configuredApiKeys]
  );

  const isVisibleForTeam = useCallback((entry: ModelEntry) => {
    return entry.enabled && !entry.hiddenForTeam;
  }, []);

  // Mutation to toggle model visibility via Convex
  const toggleModelMutation = useMutation({
    mutationFn: async ({
      modelName,
      hidden,
    }: {
      modelName: string;
      hidden: boolean;
    }) => {
      return await convex.mutation(api.teamModelVisibility.toggleModel, {
        teamSlugOrId,
        modelName,
        hidden,
      });
    },
    onSuccess: () => {
      void refetchModels();
    },
    onError: (error) => {
      toast.error("Failed to update team visibility");
      console.error("Toggle model error:", error);
    },
  });

  const handleSetVisibility = useCallback(
    (modelName: string, visible: boolean) => {
      toggleModelMutation.mutate({ modelName, hidden: !visible });
    },
    [toggleModelMutation]
  );

  // Filter and group models by vendor
  const filteredAndGroupedModels = useMemo(() => {
    if (!convexModels) return new Map<AgentVendor, ModelEntry[]>();

    const searchLower = searchQuery.toLowerCase();

    const filtered = convexModels.filter((entry) => {
      // Hide unavailable models (no API key configured)
      if (!isModelAvailable(entry)) return false;

      // Apply search filter
      if (searchQuery) {
        const matchesSearch =
          entry.name.toLowerCase().includes(searchLower) ||
          entry.displayName.toLowerCase().includes(searchLower) ||
          entry.vendor.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Apply hidden-only filter
      if (showHiddenOnly && isVisibleForTeam(entry)) {
        return false;
      }

      return true;
    });

    // Group by vendor preserving sortOrder
    const grouped = new Map<AgentVendor, ModelEntry[]>();
    for (const entry of filtered) {
      const vendor = entry.vendor as AgentVendor;
      const existing = grouped.get(vendor);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(vendor, [entry]);
      }
    }

    return grouped;
  }, [convexModels, searchQuery, showHiddenOnly, isModelAvailable, isVisibleForTeam]);

  // Count only available models (with API keys configured)
  const availableModels = convexModels?.filter(isModelAvailable) ?? [];
  const visibleCount = availableModels.filter(isVisibleForTeam).length;
  const totalCount = availableModels.length;

  return (
    <div className="space-y-4">
      <SettingSection
        title="Model Management"
        description={`${visibleCount} of ${totalCount} models visible for this team`}
      >
        <div className="p-4 space-y-4">
          {/* Search and filter controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-10 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={showHiddenOnly}
                onChange={(e) => setShowHiddenOnly(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
              />
              Show hidden only
            </label>
          </div>

          {/* Model list grouped by vendor */}
          <div className="space-y-4">
            {Array.from(filteredAndGroupedModels.entries()).map(
              ([vendor, entries]) => (
                <div key={vendor} className="space-y-2">
                  {/* Vendor header */}
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {VENDOR_DISPLAY_NAMES[vendor]}
                  </h3>

                  {/* Model rows */}
                  <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-200 dark:border-neutral-800 dark:divide-neutral-800">
                    {entries.map((entry) => {
                      const isVisible = isVisibleForTeam(entry);
                      const isSystemDisabled = !entry.enabled;
                      const isToggling =
                        toggleModelMutation.isPending &&
                        toggleModelMutation.variables?.modelName === entry.name;

                      return (
                        <div
                          key={entry._id}
                          className="flex items-center justify-between gap-4 px-3 py-2.5"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <AgentLogo
                              agentName={entry.name}
                              vendor={entry.vendor as AgentVendor}
                              className="h-5 w-5 flex-shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                {entry.displayName}
                              </p>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                {entry.name}
                                {isSystemDisabled
                                  ? " (system disabled)"
                                  : entry.hiddenForTeam
                                    ? " (hidden for this team)"
                                    : ""}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            {/* Tags */}
                            <div className="hidden sm:flex items-center gap-1">
                              {entry.tags?.includes("latest") && (
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                  Latest
                                </span>
                              )}
                              {entry.tags?.includes("recommended") && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                  Recommended
                                </span>
                              )}
                              {entry.tier === "free" && (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  Free
                                </span>
                              )}
                              {entry.tags?.includes("reasoning") && (
                                <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                  Reasoning
                                </span>
                              )}
                              {entry.disabled && (
                                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                  N/A
                                </span>
                              )}
                              {isSystemDisabled && (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                  System disabled
                                </span>
                              )}
                              {!isSystemDisabled && entry.hiddenForTeam && (
                                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                  Hidden for team
                                </span>
                              )}
                            </div>

                            {/* Team visibility toggle */}
                            <Switch
                              aria-label={`Show ${entry.displayName} for this team`}
                              size="sm"
                              color="primary"
                              isSelected={isVisible}
                              isDisabled={isToggling || isSystemDisabled || entry.disabled}
                              onValueChange={(visible) =>
                                handleSetVisibility(entry.name, visible)
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            {filteredAndGroupedModels.size === 0 && (
              <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center dark:border-neutral-700">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {searchQuery || showHiddenOnly
                    ? "No models match your filters"
                    : "No models available"}
                </p>
              </div>
            )}
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
