"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@stackframe/stack";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Model = {
  _id: string;
  name: string;
  displayName: string;
  vendor: string;
  source: "curated" | "discovered";
  discoveredFrom?: string;
  requiredApiKeys: string[];
  tier: "free" | "paid";
  tags: string[];
  enabled: boolean;
  sortOrder: number;
  disabled?: boolean;
  disabledReason?: string;
  hiddenForTeam: boolean;
};

type ApiKeyInfo = {
  envVar: string;
  displayName: string;
  description?: string;
  hasValue: boolean;
  maskedValue?: string;
  updatedAt?: number;
};

const VENDOR_DISPLAY_NAMES: Record<string, string> = {
  anthropic: "CLAUDE",
  openai: "OPENAI / CODEX",
  google: "GEMINI",
  openrouter: "OPENROUTER",
  xai: "XAI",
  modelstudio: "ALIBABA",
  opencode: "OPENCODE",
};

// Provider icons (simple colored dots for now)
const VENDOR_COLORS: Record<string, string> = {
  anthropic: "bg-orange-500",
  openai: "bg-emerald-500",
  google: "bg-blue-500",
  openrouter: "bg-purple-500",
  xai: "bg-neutral-500",
  modelstudio: "bg-amber-500",
  opencode: "bg-cyan-500",
};

export function ModelsClient() {
  const user = useUser();
  const [models, setModels] = useState<Model[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHiddenOnly, setShowHiddenOnly] = useState(false);
  const [teamSlugOrId, setTeamSlugOrId] = useState<string | null>(null);
  const [togglingModel, setTogglingModel] = useState<string | null>(null);

  // Get team from user
  useEffect(() => {
    const fetchTeam = async () => {
      if (!user) return;
      try {
        const teams = await user.listTeams();
        if (teams.length > 0) {
          const team = teams[0];
          setTeamSlugOrId(team.id);
        }
      } catch (err) {
        console.error("Failed to fetch teams:", err);
      }
    };
    void fetchTeam();
  }, [user]);

  // Fetch models and API keys
  const fetchData = useCallback(async () => {
    if (!teamSlugOrId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [modelsRes, apiKeysRes] = await Promise.all([
        fetch(`/api/models?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`),
        fetch(`/api/api-keys?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`),
      ]);

      if (!modelsRes.ok) {
        throw new Error(`Failed to fetch models: ${modelsRes.statusText}`);
      }
      if (!apiKeysRes.ok) {
        throw new Error(`Failed to fetch API keys: ${apiKeysRes.statusText}`);
      }

      const modelsData = await modelsRes.json() as { models: Model[] };
      const apiKeysData = await apiKeysRes.json() as { apiKeys: ApiKeyInfo[] };

      setModels(modelsData.models);
      setApiKeys(apiKeysData.apiKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Failed to fetch models:", err);
    } finally {
      setIsLoading(false);
    }
  }, [teamSlugOrId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const isVisibleForTeam = useCallback(
    (model: Model) => model.enabled && !model.hiddenForTeam,
    []
  );

  // Toggle model visibility for the current team
  const handleToggleModel = async (modelName: string, visible: boolean) => {
    if (!teamSlugOrId) return;

    setTogglingModel(modelName);
    try {
      const res = await fetch(
        `/api/models/${encodeURIComponent(modelName)}/enabled?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: visible }),
        }
      );

      if (!res.ok) {
        throw new Error("Failed to toggle model");
      }

      // Update local state optimistically
      setModels((prev) =>
        prev.map((m) =>
          m.name === modelName ? { ...m, hiddenForTeam: !visible } : m
        )
      );
    } catch (err) {
      console.error("Failed to toggle model:", err);
      // Revert on error
      await fetchData();
    } finally {
      setTogglingModel(null);
    }
  };

  // Build a Set of configured API key env vars for efficient lookup
  const configuredApiKeys = useMemo(() => {
    return new Set(
      apiKeys.filter((k) => k.hasValue).map((k) => k.envVar)
    );
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

  // Filter models
  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !model.name.toLowerCase().includes(query) &&
          !model.displayName.toLowerCase().includes(query) &&
          !model.vendor.toLowerCase().includes(query)
        ) {
          return false;
        }
      }

      // Hidden only filter
      if (showHiddenOnly && isVisibleForTeam(model)) {
        return false;
      }

      return true;
    });
  }, [models, searchQuery, showHiddenOnly, isVisibleForTeam]);

  // Group models by vendor for display
  const groupedModels = useMemo(() => {
    const groups: Record<string, Model[]> = {};
    for (const model of filteredModels) {
      if (!groups[model.vendor]) {
        groups[model.vendor] = [];
      }
      groups[model.vendor].push(model);
    }
    return groups;
  }, [filteredModels]);

  const visibleCount = models.filter(isVisibleForTeam).length;

  if (!user) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-neutral-500 dark:text-neutral-400">Please sign in to manage models.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
          Model Management
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {visibleCount} of {models.length} models visible for this team
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 pl-10 pr-4 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showHiddenOnly}
            onChange={(e) => setShowHiddenOnly(e.target.checked)}
            className="rounded border-neutral-300 dark:border-neutral-600 text-blue-600 focus:ring-blue-500"
          />
          Show hidden only
        </label>
      </div>

      {/* Models List */}
      <div className="space-y-6">
        {Object.entries(groupedModels).map(([vendor, vendorModels]) => (
          <div key={vendor}>
            <h3 className="mb-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              {VENDOR_DISPLAY_NAMES[vendor] || vendor.toUpperCase()}
            </h3>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
              {vendorModels.map((model, idx) => {
                const available = isModelAvailable(model);
                const isToggling = togglingModel === model.name;
                const visibleForTeam = isVisibleForTeam(model);
                const systemDisabled = !model.enabled;

                return (
                  <div
                    key={model._id}
                    className={cn(
                      "flex items-center gap-4 px-4 py-3",
                      idx !== vendorModels.length - 1 && "border-b border-neutral-100 dark:border-neutral-800",
                      (!available || systemDisabled) && "opacity-50"
                    )}
                  >
                    {/* Provider Icon */}
                    <div
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center",
                        VENDOR_COLORS[vendor] || "bg-neutral-500"
                      )}
                    >
                      <span className="text-white text-xs font-bold">
                        {vendor.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Model Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900 dark:text-white">
                          {model.displayName}
                        </span>
                        {/* Tags */}
                        {model.tags.includes("latest") && (
                          <span className="rounded bg-blue-100 dark:bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 uppercase">
                            Latest
                          </span>
                        )}
                        {model.tags.includes("recommended") && (
                          <span className="rounded bg-emerald-100 dark:bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 uppercase">
                            Recommended
                          </span>
                        )}
                        {model.tags.includes("reasoning") && (
                          <span className="rounded bg-purple-100 dark:bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-400 uppercase">
                            Reasoning
                          </span>
                        )}
                        {model.tier === "free" && (
                          <span className="rounded bg-amber-100 dark:bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase">
                            Free
                          </span>
                        )}
                        {systemDisabled && (
                          <span className="rounded bg-red-100 dark:bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400 uppercase">
                            System Disabled
                          </span>
                        )}
                        {!systemDisabled && model.hiddenForTeam && (
                          <span className="rounded bg-neutral-200 dark:bg-neutral-700 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:text-neutral-300 uppercase">
                            Hidden For Team
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                        {model.name}
                        {systemDisabled
                          ? " (system disabled)"
                          : !available
                            ? " (provider not connected)"
                            : model.hiddenForTeam
                              ? " (hidden for this team)"
                              : ""}
                      </p>
                    </div>

                    {/* Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => void handleToggleModel(model.name, !visibleForTeam)}
                      disabled={isToggling || model.disabled || systemDisabled}
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors flex-shrink-0",
                        visibleForTeam
                          ? "bg-blue-600"
                          : "bg-neutral-300 dark:bg-neutral-600",
                        (isToggling || model.disabled || systemDisabled) && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          visibleForTeam ? "left-[22px]" : "left-0.5"
                        )}
                      >
                        {isToggling && (
                          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {filteredModels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-500 dark:text-neutral-400">
          <p>No models match your search.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setShowHiddenOnly(false);
            }}
            className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
