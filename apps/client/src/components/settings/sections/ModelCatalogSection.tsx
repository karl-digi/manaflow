import { AgentLogo } from "@/components/icons/agent-logos";
import { SettingSection } from "@/components/settings/SettingSection";
import { api } from "@cmux/convex/api";
import type { AgentVendor } from "@cmux/shared/agent-catalog";
import { Switch, Button, Spinner } from "@heroui/react";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAction, useConvex } from "convex/react";
import { GripVertical, RefreshCw, Search, Database, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";

interface ModelCatalogSectionProps {
  teamSlugOrId: string;
}

interface Model {
  _id: string;
  name: string;
  displayName: string;
  vendor: string;
  source: "curated" | "discovered";
  discoveredFrom?: string;
  discoveredAt?: number;
  requiredApiKeys: string[];
  tier: "free" | "paid";
  tags: string[];
  enabled: boolean;
  sortOrder: number;
  disabled?: boolean;
  disabledReason?: string;
  createdAt: number;
  updatedAt: number;
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

const SOURCE_FILTER_OPTIONS = [
  { value: "all", label: "All Sources" },
  { value: "curated", label: "Curated" },
  { value: "discovered", label: "Discovered" },
];

export function ModelCatalogSection({
  teamSlugOrId,
}: ModelCatalogSectionProps) {
  const convex = useConvex();
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "curated" | "discovered">("all");
  const [showDisabledOnly, setShowDisabledOnly] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [draggedModel, setDraggedModel] = useState<string | null>(null);
  const [dragOverModel, setDragOverModel] = useState<string | null>(null);

  // Query all models (admin view)
  const { data: models, refetch: refetchModels, isLoading } = useQuery(
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
    if (models && models.length > 0) return;

    // No models found - trigger seeding
    hasTriedSeeding.current = true;
    console.log("[ModelCatalogSection] No models found, triggering auto-seed...");
    ensureModelsSeeded({ teamSlugOrId })
      .then((result) => {
        if (result.seeded) {
          console.log(`[ModelCatalogSection] Auto-seeded ${result.count} models`);
          void refetchModels();
        }
      })
      .catch((error) => {
        console.error("[ModelCatalogSection] Auto-seed failed:", error);
      });
  }, [models, isLoading, ensureModelsSeeded, teamSlugOrId, refetchModels]);

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
    (model: Model) => {
      // Free models are always available
      if (model.tier === "free") return true;
      // If no API keys required, it's available
      if (model.requiredApiKeys.length === 0) return true;
      // Check if at least ONE of the required API keys is configured
      return model.requiredApiKeys.some((requiredKey) =>
        configuredApiKeys.has(requiredKey)
      );
    },
    [configuredApiKeys]
  );

  // Mutation to toggle model enabled state
  const toggleEnabledMutation = useMutation({
    mutationFn: async ({
      modelName,
      enabled,
    }: {
      modelName: string;
      enabled: boolean;
    }) => {
      return await convex.mutation(api.models.setEnabled, {
        teamSlugOrId,
        modelName,
        enabled,
      });
    },
    onSuccess: () => {
      void refetchModels();
    },
    onError: (error) => {
      toast.error("Failed to update model state");
      console.error("Toggle enabled error:", error);
    },
  });

  // Mutation to reorder models
  const reorderMutation = useMutation({
    mutationFn: async (modelNames: string[]) => {
      return await convex.mutation(api.models.reorder, {
        teamSlugOrId,
        modelNames,
      });
    },
    onSuccess: () => {
      void refetchModels();
      toast.success("Model order updated");
    },
    onError: (error) => {
      toast.error("Failed to reorder models");
      console.error("Reorder error:", error);
    },
  });

  const handleToggleEnabled = useCallback(
    (modelName: string, enabled: boolean) => {
      toggleEnabledMutation.mutate({ modelName, enabled });
    },
    [toggleEnabledMutation]
  );

  // Trigger discovery refresh via www API
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const user = await cachedGetUser(stackClientApp);
      if (!user) {
        toast.error("You must be signed in to refresh models");
        return;
      }

      const authHeaders = await user.getAuthHeaders();
      const headers = new Headers(authHeaders);
      headers.set("Content-Type", "application/json");

      const endpoint = new URL(
        `/api/models/refresh?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`,
        WWW_ORIGIN
      );

      const response = await fetch(endpoint.toString(), {
        method: "POST",
        headers,
      });

      const result = await response.json() as {
        success: boolean;
        curated?: number;
        discovered?: number;
        free?: number;
        paid?: number;
        error?: string;
      };

      if (result.success) {
        toast.success(
          `Discovery complete: ${result.curated ?? 0} curated, ${result.discovered ?? 0} discovered (${result.free ?? 0} free)`
        );
        void refetchModels();
      } else {
        toast.error(result.error ?? "Discovery failed");
      }
    } catch (error) {
      toast.error("Failed to refresh models");
      console.error("Refresh error:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [teamSlugOrId, refetchModels]);

  // Seed curated models only
  const handleSeed = useCallback(async () => {
    setIsSeeding(true);
    try {
      const user = await cachedGetUser(stackClientApp);
      if (!user) {
        toast.error("You must be signed in to seed models");
        return;
      }

      const authHeaders = await user.getAuthHeaders();
      const headers = new Headers(authHeaders);
      headers.set("Content-Type", "application/json");

      const endpoint = new URL(
        `/api/models/seed?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`,
        WWW_ORIGIN
      );

      const response = await fetch(endpoint.toString(), {
        method: "POST",
        headers,
      });

      const result = await response.json() as {
        success: boolean;
        seededCount: number;
        error?: string;
      };

      if (result.success) {
        toast.success(`Seeded ${result.seededCount} curated models`);
        void refetchModels();
      } else {
        toast.error(result.error ?? "Seeding failed");
      }
    } catch (error) {
      toast.error("Failed to seed models");
      console.error("Seed error:", error);
    } finally {
      setIsSeeding(false);
    }
  }, [teamSlugOrId, refetchModels]);

  // Drag and drop handlers
  const handleDragStart = useCallback((modelName: string) => {
    setDraggedModel(modelName);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, modelName: string) => {
    e.preventDefault();
    setDragOverModel(modelName);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedModel(null);
    setDragOverModel(null);
  }, []);

  const handleDrop = useCallback(
    (targetModelName: string) => {
      if (!draggedModel || draggedModel === targetModelName || !models) {
        return;
      }

      // Calculate new order
      const currentOrder = models.map((m) => m.name);
      const draggedIndex = currentOrder.indexOf(draggedModel);
      const targetIndex = currentOrder.indexOf(targetModelName);

      if (draggedIndex === -1 || targetIndex === -1) {
        return;
      }

      // Remove dragged item and insert at new position
      const newOrder = [...currentOrder];
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedModel);

      reorderMutation.mutate(newOrder);
      setDraggedModel(null);
      setDragOverModel(null);
    },
    [draggedModel, models, reorderMutation]
  );

  // Filter and group models
  const filteredAndGroupedModels = useMemo(() => {
    if (!models) return new Map<string, Model[]>();

    const searchLower = searchQuery.toLowerCase();

    const filtered = models.filter((entry) => {
      // Filter out unavailable models (no API key configured)
      if (!isModelAvailable(entry)) {
        return false;
      }

      // Apply search filter
      if (searchQuery) {
        const matchesSearch =
          entry.name.toLowerCase().includes(searchLower) ||
          entry.displayName.toLowerCase().includes(searchLower) ||
          entry.vendor.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Apply source filter
      if (sourceFilter !== "all" && entry.source !== sourceFilter) {
        return false;
      }

      // Apply disabled-only filter
      if (showDisabledOnly && entry.enabled) {
        return false;
      }

      return true;
    });

    // Group by vendor preserving sort order
    const grouped = new Map<string, Model[]>();
    for (const entry of filtered) {
      const existing = grouped.get(entry.vendor);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.vendor, [entry]);
      }
    }

    return grouped;
  }, [models, searchQuery, sourceFilter, showDisabledOnly, isModelAvailable]);

  const enabledCount = models?.filter((m) => m.enabled).length ?? 0;
  const totalCount = models?.length ?? 0;
  const curatedCount = models?.filter((m) => m.source === "curated").length ?? 0;
  const discoveredCount = models?.filter((m) => m.source === "discovered").length ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  // Empty state when no models in catalog
  if (!models || models.length === 0) {
    return (
      <div className="space-y-4">
        <SettingSection
          title="Model Catalog"
          description="Global model management for admins"
        >
          <div className="p-8 text-center">
            <Database className="mx-auto h-12 w-12 text-neutral-400 dark:text-neutral-600 mb-4" />
            <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              No models in catalog
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
              Seed the catalog with curated models or discover new ones from providers.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                color="primary"
                isLoading={isSeeding}
                onPress={() => void handleSeed()}
                startContent={!isSeeding && <Database className="h-4 w-4" />}
              >
                Seed Curated Models
              </Button>
              <Button
                variant="bordered"
                isLoading={isRefreshing}
                onPress={() => void handleRefresh()}
                startContent={!isRefreshing && <RefreshCw className="h-4 w-4" />}
              >
                Discover Models
              </Button>
            </div>
          </div>
        </SettingSection>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingSection
        title="Model Catalog"
        description={`${enabledCount} of ${totalCount} models enabled (${curatedCount} curated, ${discoveredCount} discovered)`}
      >
        <div className="p-4 space-y-4">
          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              {/* Search */}
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

              {/* Source filter */}
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as "all" | "curated" | "discovered")}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {SOURCE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <input
                  type="checkbox"
                  checked={showDisabledOnly}
                  onChange={(e) => setShowDisabledOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
                />
                Disabled only
              </label>

              <Button
                size="sm"
                variant="bordered"
                isLoading={isRefreshing}
                onPress={() => void handleRefresh()}
                startContent={!isRefreshing && <RefreshCw className="h-4 w-4" />}
              >
                Discover
              </Button>
            </div>
          </div>

          {/* Model list grouped by vendor */}
          <div className="space-y-4">
            {Array.from(filteredAndGroupedModels.entries()).map(
              ([vendor, entries]) => (
                <div key={vendor} className="space-y-2">
                  {/* Vendor header */}
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {VENDOR_DISPLAY_NAMES[vendor as AgentVendor] ?? vendor}
                  </h3>

                  {/* Model rows */}
                  <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-200 dark:border-neutral-800 dark:divide-neutral-800">
                    {entries.map((entry) => {
                      const isToggling =
                        toggleEnabledMutation.isPending &&
                        toggleEnabledMutation.variables?.modelName === entry.name;
                      const isDragging = draggedModel === entry.name;
                      const isDragOver = dragOverModel === entry.name;
                      return (
                        <div
                          key={entry.name}
                          draggable
                          onDragStart={() => handleDragStart(entry.name)}
                          onDragOver={(e) => handleDragOver(e, entry.name)}
                          onDragEnd={handleDragEnd}
                          onDrop={() => handleDrop(entry.name)}
                          className={`flex items-center justify-between gap-4 px-3 py-2.5 cursor-grab active:cursor-grabbing transition-colors ${
                            isDragging ? "opacity-50 bg-neutral-100 dark:bg-neutral-800" : ""
                          } ${
                            isDragOver ? "bg-blue-50 dark:bg-blue-900/20" : ""
                          }`}
                        >
                          {/* Drag handle + Logo + Name */}
                          <div className="flex items-center gap-3 min-w-0">
                            <GripVertical className="h-4 w-4 text-neutral-400 flex-shrink-0" />
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
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            {/* Badges */}
                            <div className="hidden sm:flex items-center gap-1">
                              {/* Source badge */}
                              {entry.source === "curated" ? (
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                  Curated
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                  Discovered
                                </span>
                              )}

                              {/* Tier badge */}
                              {entry.tier === "free" && (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  Free
                                </span>
                              )}

                              {/* Tags */}
                              {entry.tags?.includes("latest") && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                  Latest
                                </span>
                              )}
                              {entry.tags?.includes("reasoning") && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                                  <Zap className="h-2.5 w-2.5" />
                                  Reasoning
                                </span>
                              )}

                              {/* Disabled badge (model-level, not global enabled state) */}
                              {entry.disabled && (
                                <span
                                  className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                                  title={entry.disabledReason}
                                >
                                  N/A
                                </span>
                              )}
                            </div>

                            {/* Enable/Disable toggle */}
                            <Switch
                              aria-label={`Enable ${entry.displayName} globally`}
                              size="sm"
                              color="primary"
                              isSelected={entry.enabled}
                              isDisabled={isToggling}
                              onValueChange={(enabled) =>
                                handleToggleEnabled(entry.name, enabled)
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
                  {searchQuery || sourceFilter !== "all" || showDisabledOnly
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
