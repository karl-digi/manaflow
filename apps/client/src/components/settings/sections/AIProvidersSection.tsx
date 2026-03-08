import { ProviderStatusSettings } from "@/components/provider-status-settings";
import { SettingSection } from "@/components/settings/SettingSection";
import {
  ANTHROPIC_BASE_URL_KEY,
  API_KEY_TO_BASE_URL,
  type ProviderBaseUrlKey,
} from "@cmux/shared";
import { Switch } from "@heroui/react";
import { CheckCircle2, ChevronDown, Eye, EyeOff, ExternalLink, XCircle } from "lucide-react";
import type { MutableRefObject } from "react";

export interface ProviderInfo {
  url?: string;
  helpText?: string;
}

export type ConnectionTestResult = {
  status: "success" | "error";
  message: string;
  details?: {
    statusCode?: number;
    responseTime?: number;
    endpoint: string;
    modelsFound?: number;
  };
};

interface ApiKeyDefinition {
  envVar: string;
  displayName: string;
  description?: string;
}

interface AIProvidersSectionProps {
  apiKeys: ApiKeyDefinition[];
  providerInfoByEnvVar: Record<string, ProviderInfo>;
  apiKeyModelsByEnv: Record<string, string[]>;
  apiKeyValues: Record<string, string>;
  originalApiKeyValues: Record<string, string>;
  showKeys: Record<string, boolean>;
  showBaseUrls: boolean;
  baseUrlValues: Record<string, string>;
  isTestingConnection: Record<string, boolean>;
  connectionTestResults: Record<string, ConnectionTestResult | null>;
  bypassAnthropicProxy: boolean;
  expandedUsedList: Record<string, boolean>;
  overflowUsedList: Record<string, boolean>;
  usedListRefs: MutableRefObject<Record<string, HTMLSpanElement | null>>;
  showProviderStatus: boolean;
  onApiKeyChange: (envVar: string, value: string) => void;
  onToggleShowKey: (envVar: string) => void;
  onToggleShowBaseUrls: () => void;
  onBaseUrlChange: (baseUrlKey: ProviderBaseUrlKey, value: string) => void;
  onTestBaseUrlConnection: (
    baseUrlKey: ProviderBaseUrlKey,
    apiKeyEnvVar: string
  ) => void;
  onBypassAnthropicProxyChange: (value: boolean) => void;
  onToggleUsedList: (envVar: string) => void;
}

function getApiKeyPlaceholder(key: ApiKeyDefinition): string {
  if (key.envVar === "CLAUDE_CODE_OAUTH_TOKEN") {
    return "sk-ant-oat01-...";
  }
  if (key.envVar === "ANTHROPIC_API_KEY") {
    return "sk-ant-api03-...";
  }
  if (key.envVar === "OPENAI_API_KEY") {
    return "sk-proj-...";
  }
  if (key.envVar === "OPENROUTER_API_KEY") {
    return "sk-or-v1-...";
  }
  return `Enter your ${key.displayName}`;
}

export function AIProvidersSection({
  apiKeys,
  providerInfoByEnvVar,
  apiKeyModelsByEnv,
  apiKeyValues,
  originalApiKeyValues,
  showKeys,
  showBaseUrls,
  baseUrlValues,
  isTestingConnection,
  connectionTestResults,
  bypassAnthropicProxy,
  expandedUsedList,
  overflowUsedList,
  usedListRefs,
  showProviderStatus,
  onApiKeyChange,
  onToggleShowKey,
  onToggleShowBaseUrls,
  onBaseUrlChange,
  onTestBaseUrlConnection,
  onBypassAnthropicProxyChange,
  onToggleUsedList,
}: AIProvidersSectionProps) {
  return (
    <div className="space-y-4">
      <SettingSection title="AI Provider Authentication">
        <div className="p-4">
          {apiKeys.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              No API keys are required for the configured agents.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    API Key Authentication
                  </h3>
                  <button
                    type="button"
                    onClick={onToggleShowBaseUrls}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {showBaseUrls ? "Hide more" : "Show more"}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        showBaseUrls ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <p>You can authenticate providers in two ways:</p>
                  <ul className="ml-4 list-disc space-y-0.5">
                    <li>
                      Sign in using a provider CLI (Claude Code, Codex CLI,
                      Gemini CLI, Amp, Opencode).
                    </li>
                    <li>
                      Or enter API keys here and cmux will use them directly.
                    </li>
                  </ul>
                </div>
              </div>

              {apiKeys.map((key) => {
                const providerInfo = providerInfoByEnvVar[key.envVar];
                const usedModels = apiKeyModelsByEnv[key.envVar] ?? [];
                const baseUrlKey = API_KEY_TO_BASE_URL[key.envVar];
                const baseUrlValue = baseUrlKey
                  ? baseUrlValues[baseUrlKey.envVar] || ""
                  : "";
                const hasBaseUrlValue = baseUrlValue.trim().length > 0;
                const connectionResult = baseUrlKey
                  ? connectionTestResults[baseUrlKey.envVar]
                  : null;

                const isConnected = !!(apiKeyValues[key.envVar]?.trim());

                return (
                  <div
                    key={key.envVar}
                    className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={key.envVar}
                            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                          >
                            {key.displayName}
                          </label>
                          {/* Connection status badge */}
                          {isConnected ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Connected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                              <XCircle className="h-3 w-3" />
                              Not configured
                            </span>
                          )}
                        </div>
                        {providerInfo?.helpText ? (
                          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                            {providerInfo.helpText}
                          </p>
                        ) : null}

                        {usedModels.length > 0 ? (
                          <div className="mt-1">
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              Used for agents:{" "}
                              <span className="inline-flex min-w-0 items-center gap-1 align-middle">
                                <span
                                  ref={(element) => {
                                    usedListRefs.current[key.envVar] = element;
                                  }}
                                  className={`min-w-0 font-medium ${
                                    expandedUsedList[key.envVar]
                                      ? "whitespace-normal break-words"
                                      : "truncate"
                                  }`}
                                >
                                  {usedModels.join(", ")}
                                </span>
                                {overflowUsedList[key.envVar] ? (
                                  <button
                                    type="button"
                                    onClick={() => onToggleUsedList(key.envVar)}
                                    className="flex-none text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    {expandedUsedList[key.envVar]
                                      ? "Hide more"
                                      : "Show more"}
                                  </button>
                                ) : null}
                              </span>
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {providerInfo?.url ? (
                        <a
                          href={providerInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Get key
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>

                    <div className="md:w-[min(100%,480px)] md:flex-shrink-0">
                      {key.envVar === "CODEX_AUTH_JSON" ? (
                        <div className="relative">
                          {showKeys[key.envVar] ? (
                            <textarea
                              id={key.envVar}
                              value={apiKeyValues[key.envVar] || ""}
                              onChange={(event) =>
                                onApiKeyChange(key.envVar, event.target.value)
                              }
                              rows={4}
                              className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-10 font-mono text-xs text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              placeholder='{"tokens": {"id_token": "...", "access_token": "...", "refresh_token": "...", "account_id": "..."}, "last_refresh": "..."}'
                            />
                          ) : (
                            <div
                              onClick={() => onToggleShowKey(key.envVar)}
                              className="h-[82px] w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-10 font-mono text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            >
                              {apiKeyValues[key.envVar] ? (
                                "••••••••••••••••••••••••••••••••"
                              ) : (
                                <span className="text-neutral-400">
                                  Click to edit
                                </span>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => onToggleShowKey(key.envVar)}
                            className="absolute right-2 top-2 p-1 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                            aria-label={
                              showKeys[key.envVar] ? "Hide value" : "Show value"
                            }
                          >
                            {showKeys[key.envVar] ? (
                              <EyeOff className="h-5 w-5" />
                            ) : (
                              <Eye className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type={showKeys[key.envVar] ? "text" : "password"}
                            id={key.envVar}
                            name={`api-key-${key.envVar}`}
                            value={apiKeyValues[key.envVar] || ""}
                            onChange={(event) =>
                              onApiKeyChange(key.envVar, event.target.value)
                            }
                            autoComplete="new-password"
                            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-10 font-mono text-xs text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            placeholder={getApiKeyPlaceholder(key)}
                          />
                          <button
                            type="button"
                            onClick={() => onToggleShowKey(key.envVar)}
                            className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-500"
                            aria-label={
                              showKeys[key.envVar] ? "Hide value" : "Show value"
                            }
                          >
                            {showKeys[key.envVar] ? (
                              <EyeOff className="h-5 w-5" />
                            ) : (
                              <Eye className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      )}

                      {originalApiKeyValues[key.envVar] ? (
                        <div className="mt-1 flex items-center gap-1">
                          <svg
                            className="h-3 w-3 text-green-500 dark:text-green-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <span className="text-xs text-green-600 dark:text-green-400">
                            API key configured
                          </span>
                        </div>
                      ) : null}

                      {showBaseUrls && baseUrlKey ? (
                        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                          <label
                            htmlFor={baseUrlKey.envVar}
                            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                          >
                            {baseUrlKey.displayName}
                          </label>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                            {baseUrlKey.description}
                            {baseUrlKey.envVar === ANTHROPIC_BASE_URL_KEY.envVar
                              ? " Enter the base URL without the /v1 suffix. Example: https://my-proxy.example.com"
                              : ""}
                          </p>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              id={baseUrlKey.envVar}
                              type="text"
                              value={baseUrlValue}
                              onChange={(event) =>
                                onBaseUrlChange(baseUrlKey, event.target.value)
                              }
                              className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              placeholder={baseUrlKey.placeholder}
                              autoComplete="off"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                onTestBaseUrlConnection(baseUrlKey, key.envVar)
                              }
                              disabled={
                                !hasBaseUrlValue ||
                                !apiKeyValues[key.envVar]?.trim() ||
                                isTestingConnection[baseUrlKey.envVar]
                              }
                              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                            >
                              {isTestingConnection[baseUrlKey.envVar]
                                ? "Testing..."
                                : "Test Connection"}
                            </button>
                          </div>

                          {connectionResult ? (
                            <div
                              className={`mt-1 rounded-lg px-2 py-1.5 text-[11px] ${
                                connectionResult.status === "success"
                                  ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                                  : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                              }`}
                            >
                              <span className="font-medium">
                                {connectionResult.status === "success"
                                  ? "Success: "
                                  : "Error: "}
                              </span>
                              {connectionResult.message}
                              {connectionResult.details?.endpoint ? (
                                <div className="mt-1 text-neutral-500 dark:text-neutral-400">
                                  Tested: {connectionResult.details.endpoint}
                                  {connectionResult.details.responseTime !==
                                  undefined
                                    ? ` (${connectionResult.details.responseTime}ms)`
                                    : ""}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {baseUrlKey.envVar === ANTHROPIC_BASE_URL_KEY.envVar &&
                          hasBaseUrlValue ? (
                            <div className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                              <div>
                                <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                  Bypass cmux Anthropic proxy
                                </p>
                                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                  When enabled, Claude connects directly to your
                                  custom Anthropic endpoint.
                                </p>
                              </div>
                              <Switch
                                aria-label="Bypass cmux Anthropic proxy"
                                size="sm"
                                color="primary"
                                isSelected={bypassAnthropicProxy}
                                onValueChange={onBypassAnthropicProxyChange}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingSection>

      {showProviderStatus ? (
        <SettingSection title="Provider Status">
          <div className="p-4">
            <ProviderStatusSettings />
          </div>
        </SettingSection>
      ) : null}
    </div>
  );
}
