"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@stackframe/stack";
import { Check, Eye, EyeOff, Loader2, ExternalLink } from "lucide-react";
import { ALL_API_KEYS, API_KEY_MODELS_BY_ENV } from "@cmux/shared";
import type { AgentConfigApiKey } from "@cmux/shared";

type ApiKeyInfo = {
  envVar: string;
  displayName: string;
  description?: string;
  hasValue: boolean;
  maskedValue?: string;
  updatedAt?: number;
};

// Links to get API keys
const API_KEY_LINKS: Record<string, string> = {
  ANTHROPIC_API_KEY: "https://console.anthropic.com/settings/keys",
  OPENAI_API_KEY: "https://platform.openai.com/api-keys",
  GEMINI_API_KEY: "https://aistudio.google.com/app/apikey",
  OPENROUTER_API_KEY: "https://openrouter.ai/settings/keys",
  XAI_API_KEY: "https://console.x.ai/",
};

export function ProvidersClient() {
  const user = useUser();
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showKeyValue, setShowKeyValue] = useState<Record<string, boolean>>({});
  const [teamSlugOrId, setTeamSlugOrId] = useState<string | null>(null);

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

  // Fetch API keys
  const fetchData = useCallback(async () => {
    if (!teamSlugOrId) return;

    setIsLoading(true);
    setError(null);

    try {
      const keysRes = await fetch(`/api/api-keys?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`);

      if (!keysRes.ok) {
        throw new Error(`Failed to fetch API keys: ${keysRes.statusText}`);
      }

      const keysData = await keysRes.json() as { apiKeys: ApiKeyInfo[] };
      setApiKeys(keysData.apiKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Failed to fetch API keys:", err);
    } finally {
      setIsLoading(false);
    }
  }, [teamSlugOrId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSaveKey = async (envVar: string) => {
    if (!teamSlugOrId || !keyValue) return;

    const keyDef = ALL_API_KEYS.find((k) => k.envVar === envVar);
    if (!keyDef) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/api-keys?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envVar,
          value: keyValue,
          displayName: keyDef.displayName,
          description: keyDef.description,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save API key");
      }

      await fetchData();
      setEditingKey(null);
      setKeyValue("");
    } catch (err) {
      console.error("Failed to save API key:", err);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteKey = async (envVar: string) => {
    if (!teamSlugOrId) return;

    try {
      const res = await fetch(
        `/api/api-keys/${encodeURIComponent(envVar)}?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        throw new Error("Failed to delete API key");
      }

      await fetchData();
    } catch (err) {
      console.error("Failed to delete API key:", err);
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const toggleShowKeyValue = (envVar: string) => {
    setShowKeyValue((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-neutral-500 dark:text-neutral-400">Please sign in to manage providers.</p>
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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
          AI Provider Authentication
        </h2>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* API Key Authentication Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-medium text-neutral-900 dark:text-white">
            API Key Authentication
          </h3>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Add API keys for each provider to enable their models. Keys are encrypted and stored securely.
          </p>
        </div>

        {/* API Key Cards */}
        <div className="space-y-4">
          {ALL_API_KEYS.map((keyDef: AgentConfigApiKey) => {
            const keyInfo = apiKeys.find((k) => k.envVar === keyDef.envVar);
            const isConnected = keyInfo?.hasValue ?? false;
            const isEditing = editingKey === keyDef.envVar;
            const isShowingValue = showKeyValue[keyDef.envVar] ?? false;
            const agents = API_KEY_MODELS_BY_ENV[keyDef.envVar] ?? [];
            const getKeyLink = API_KEY_LINKS[keyDef.envVar];

            return (
              <div
                key={keyDef.envVar}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="font-medium text-neutral-900 dark:text-white">
                        {keyDef.displayName}
                      </h4>
                      {isConnected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <Check className="h-3 w-3" />
                          Connected
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          Not configured
                        </span>
                      )}
                    </div>
                    {keyDef.description && (
                      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {keyDef.description}
                      </p>
                    )}
                  </div>

                  {getKeyLink && !isConnected && (
                    <a
                      href={getKeyLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Get key
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {/* Agents using this key */}
                {agents.length > 0 && (
                  <div className="mt-3">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      Used for agents:{" "}
                    </span>
                    <span className="text-xs text-neutral-700 dark:text-neutral-300">
                      {agents.join(", ")}
                    </span>
                  </div>
                )}

                {/* Input Section */}
                <div className="mt-4">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="relative">
                        <input
                          type={isShowingValue ? "text" : "password"}
                          name="api-key-value"
                          value={keyValue}
                          onChange={(e) => setKeyValue(e.target.value)}
                          placeholder="Enter API key"
                          autoComplete="new-password"
                          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2.5 pr-10 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => toggleShowKeyValue(keyDef.envVar)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
                        >
                          {isShowingValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveKey(keyDef.envVar)}
                          disabled={!keyValue || isSaving}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(null);
                            setKeyValue("");
                          }}
                          className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : isConnected ? (
                    <div className="space-y-3">
                      <div className="relative">
                        <input
                          type={isShowingValue ? "text" : "password"}
                          value={isShowingValue ? (keyInfo?.maskedValue ?? "••••••••••••") : "••••••••••••••••••••"}
                          readOnly
                          className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2.5 pr-10 text-sm text-neutral-700 dark:text-neutral-300"
                        />
                        <button
                          type="button"
                          onClick={() => toggleShowKeyValue(keyDef.envVar)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
                        >
                          {isShowingValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                          <Check className="h-4 w-4" />
                          API key configured
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKey(keyDef.envVar);
                              setKeyValue("");
                            }}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Update
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteKey(keyDef.envVar)}
                            className="text-sm text-red-600 dark:text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(keyDef.envVar);
                        setKeyValue("");
                      }}
                      className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      Add API Key
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
