import { TerminalSession } from "@/components/xterm/TerminalSession";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

const TERMINAL_BACKEND_PORT = 39383;

function resolveBackendBaseUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const { hostname, protocol } = window.location;
  const safeHost = hostname && hostname.length > 0 ? hostname : "127.0.0.1";
  const isSecure = protocol === "https:";
  const scheme = isSecure ? "https:" : "http:";
  return `${scheme}//${safeHost}:${TERMINAL_BACKEND_PORT}`;
}

function buildTabsUrl(baseUrl: string): string {
  return new URL("/api/tabs", baseUrl).toString();
}

export function TaskRunTerminals() {
  const backendBaseUrl = useMemo(() => resolveBackendBaseUrl(), []);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const tabsQuery = useQuery({
    queryKey: ["task-run-terminals", backendBaseUrl],
    enabled: backendBaseUrl !== null,
    queryFn: async () => {
      if (!backendBaseUrl) {
        return [] as string[];
      }
      const response = await fetch(buildTabsUrl(backendBaseUrl));
      if (!response.ok) {
        throw new Error(
          `Failed to load terminals from backend (${response.status})`
        );
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Unexpected response from terminal backend");
      }
      return payload.map((value) => String(value));
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
  });

  const tabs = tabsQuery.data ?? [];

  const errorMessage = useMemo(() => {
    if (!tabsQuery.error) return null;
    return tabsQuery.error instanceof Error
      ? tabsQuery.error.message
      : String(tabsQuery.error);
  }, [tabsQuery.error]);

  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTab((prev) => (prev === null ? prev : null));
      return;
    }
    setActiveTab((prev) => (prev && tabs.includes(prev) ? prev : tabs[0]));
  }, [tabs]);

  const handleSelectTab = useCallback((id: string) => {
    setActiveTab(id);
  }, []);

  if (backendBaseUrl === null) {
    return (
      <div className="flex grow flex-col items-center justify-center gap-2 p-6 text-sm text-neutral-600 dark:text-neutral-400">
        <p>Terminals are unavailable in this environment.</p>
      </div>
    );
  }

  return (
    <div className="flex grow flex-col min-h-0 bg-white dark:bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
        <span className="font-medium uppercase tracking-wide">
          Terminals
        </span>
        <span className="text-neutral-400 dark:text-neutral-500">
          {tabsQuery.isLoading ? "Loading…" : `${tabs.length} active`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          onClick={() => tabsQuery.refetch()}
          disabled={tabsQuery.isFetching}
          title="Refresh terminals"
        >
          <RefreshCw
            className={tabsQuery.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
          />
        </Button>
      </div>

      {tabsQuery.isError ? (
        <div className="flex grow flex-col items-center justify-center gap-2 p-6 text-sm text-red-600 dark:text-red-400">
          <p>Unable to connect to the terminal backend.</p>
          {errorMessage ? (
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-xs">
              {errorMessage}
            </pre>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => tabsQuery.refetch()}
            disabled={tabsQuery.isFetching}
          >
            Try again
          </Button>
        </div>
      ) : tabs.length === 0 ? (
        <div className="flex grow flex-col items-center justify-center gap-2 p-6 text-sm text-neutral-600 dark:text-neutral-400">
          <p>No terminal sessions reported by the backend.</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-500">
            Sessions appear automatically once available.
          </p>
        </div>
      ) : (
        <div className="flex grow flex-col min-h-0">
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-2 py-2 dark:border-neutral-800 dark:bg-neutral-950">
            {tabs.map((id) => {
              const isActive = id === activeTab;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectTab(id)}
                  className={`min-w-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <span className="block truncate">{id}</span>
                </button>
              );
            })}
          </div>
          <div className="flex grow min-h-0">
            {activeTab ? (
              <TerminalSession
                key={activeTab}
                backendBaseUrl={backendBaseUrl}
                terminalId={activeTab}
                isActive
                className="grow"
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
