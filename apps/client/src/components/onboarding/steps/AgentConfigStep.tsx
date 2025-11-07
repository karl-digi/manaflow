import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, XCircle, Circle } from "lucide-react";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { useCallback, useEffect, useState } from "react";
import { useSocket } from "@/contexts/socket/use-socket";
import type { ProviderStatusResponse } from "@cmux/shared";

interface AgentConfigStepProps {
  onNext: () => void;
  onSkip: () => void;
}

const DEFAULT_AGENTS = [
  "claude/sonnet-4.5",
  "claude/opus-4.1",
  "codex/gpt-5-codex-high",
];

export function AgentConfigStep({ onNext, onSkip }: AgentConfigStepProps) {
  const [selectedAgents, setSelectedAgents] = useState<string[]>(
    DEFAULT_AGENTS.filter((agent) =>
      AGENT_CONFIGS.some((config) => config.name === agent)
    )
  );
  const [providerStatus, setProviderStatus] =
    useState<ProviderStatusResponse | null>(null);
  const { socket } = useSocket();

  // Check provider status on mount
  useEffect(() => {
    if (!socket) return;

    const checkStatus = () => {
      socket.emit("check-provider-status", (response) => {
        if (response) {
          setProviderStatus(response);
        }
      });
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);

    return () => clearInterval(interval);
  }, [socket]);

  const handleToggleAgent = useCallback(
    (agentName: string) => {
      if (selectedAgents.includes(agentName)) {
        setSelectedAgents(selectedAgents.filter((a) => a !== agentName));
      } else {
        setSelectedAgents([...selectedAgents, agentName]);
      }
    },
    [selectedAgents]
  );

  const handleContinue = useCallback(() => {
    // Save selected agents to localStorage
    if (selectedAgents.length > 0) {
      localStorage.setItem("selectedAgents", JSON.stringify(selectedAgents));
    }
    onNext();
  }, [selectedAgents, onNext]);

  // Get available providers
  const availableProviders = providerStatus?.providers || [];
  const providersByName = new Map(
    availableProviders.map((p) => [p.name, p])
  );

  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Configure Agents
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Select agents and view their configuration status.
        </p>
      </div>

      {/* Provider Status Overview */}
      <div className="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
        <h3 className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          Provider Status
        </h3>
        <div className="space-y-1.5">
          {AGENT_CONFIGS.slice(0, 8).map((agent) => {
            const provider = providersByName.get(agent.name);
            const isAvailable = provider?.isAvailable || false;

            return (
              <div
                key={agent.name}
                className="flex items-center gap-2 text-xs"
              >
                {isAvailable ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                ) : provider ? (
                  <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-500" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-neutral-400" />
                )}
                <span className={isAvailable ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}>
                  {agent.name}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Configure API keys in Settings to enable more agents.
        </p>
      </div>

      {/* Agent Selection */}
      <div className="mb-4">
        <h3 className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          Default Agents (Optional)
        </h3>
        <div className="space-y-2">
          {AGENT_CONFIGS.slice(0, 6).map((agent) => {
            const provider = providersByName.get(agent.name);
            const isAvailable = provider?.isAvailable || false;

            return (
              <button
                key={agent.name}
                onClick={() => handleToggleAgent(agent.name)}
                disabled={!isAvailable}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                  selectedAgents.includes(agent.name)
                    ? "border-primary bg-primary/5 dark:bg-primary/10"
                    : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600"
                } ${!isAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {agent.name}
                    </div>
                  </div>
                  <div
                    className={`h-4 w-4 rounded border-2 flex items-center justify-center ${
                      selectedAgents.includes(agent.name)
                        ? "border-primary bg-primary"
                        : "border-neutral-300 dark:border-neutral-600"
                    }`}
                  >
                    {selectedAgents.includes(agent.name) && (
                      <svg
                        className="h-3 w-3 text-white"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M10 3L4.5 8.5L2 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onSkip} size="sm">
          Skip
        </Button>
        <Button
          onClick={handleContinue}
          size="sm"
          className="gap-1.5"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
