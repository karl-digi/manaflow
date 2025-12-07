"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback, useEffect } from "react";
import type { Id } from "@/convex/_generated/dataModel";

// Icons
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

interface EnvVar {
  key: string;
  value: string;
}

interface ConfigureWorkspaceProps {
  repoId: Id<"repos">;
  className?: string;
}

export function ConfigureWorkspace({
  repoId,
  className = "",
}: ConfigureWorkspaceProps) {
  // Fetch existing config
  const existingConfig = useQuery(api.workspaceConfig.getWorkspaceConfig, {
    repoId,
  });

  // Mutations
  const updateSetupScripts = useMutation(
    api.workspaceConfig.updateSetupScripts
  );

  // Local state
  const [setupScript, setSetupScript] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: "", value: "" }]);
  const [showValues, setShowValues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load from existing config
  useEffect(() => {
    if (existingConfig) {
      // Convert scripts array to single string
      const scriptStr = existingConfig.setupScripts
        ?.map((s) => s.command)
        .join("\n") || "";
      setSetupScript(scriptStr);
    }
  }, [existingConfig]);

  // Track changes
  const handleSetupScriptChange = useCallback((value: string) => {
    setSetupScript(value);
    setHasChanges(true);
  }, []);

  const handleEnvVarChange = useCallback(
    (index: number, field: keyof EnvVar, value: string) => {
      const updated = [...envVars];
      updated[index] = { ...updated[index], [field]: value };
      setEnvVars(updated);
      setHasChanges(true);
    },
    [envVars]
  );

  const addEnvVar = useCallback(() => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  }, [envVars]);

  const removeEnvVar = useCallback(
    (index: number) => {
      if (envVars.length > 1) {
        setEnvVars(envVars.filter((_, i) => i !== index));
        setHasChanges(true);
      }
    },
    [envVars]
  );

  // Save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Convert script string to array format
      const scripts = setupScript
        .split("\n")
        .filter((line) => line.trim())
        .map((command) => ({ name: "", command, description: "" }));

      await updateSetupScripts({ repoId, setupScripts: scripts });
      setHasChanges(false);
    } finally {
      setSaving(false);
    }
  }, [repoId, setupScript, updateSetupScripts]);

  return (
    <div className={`space-y-5 ${className}`}>
      {/* Setup Script Section */}
      <div>
        <h4 className="text-sm font-medium text-neutral-200 mb-1.5">
          Setup script
        </h4>
        <p className="text-xs text-neutral-500 mb-3">
          Runs after cloning your repository so dependencies and services are ready. Executed from your repository root directory.
        </p>
        <div className="bg-neutral-950 border border-neutral-800 rounded-md p-3 font-mono text-sm">
          <textarea
            value={setupScript}
            onChange={(e) => handleSetupScriptChange(e.target.value)}
            placeholder={"# e.g.\npnpm install\nbun install\nuv sync"}
            rows={4}
            className="w-full bg-transparent text-neutral-300 placeholder-neutral-600 resize-none focus:outline-none"
          />
        </div>
      </div>

      {/* Environment Variables Section */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-sm font-medium text-neutral-200">
            Environment variables
          </h4>
          <button
            type="button"
            onClick={() => setShowValues(!showValues)}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <EyeIcon className="h-3.5 w-3.5" />
            <span>{showValues ? "Hide" : "Reveal"}</span>
          </button>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          Stored securely and injected when your setup script runs. Paste directly from .env files.
        </p>

        {/* Table header */}
        <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2 mb-2 text-xs text-neutral-500">
          <span>Key</span>
          <span>Value</span>
          <span className="w-7"></span>
        </div>

        {/* Env var rows */}
        <div className="space-y-2">
          {envVars.map((envVar, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_1.5fr_auto] gap-2 items-center"
            >
              <input
                type="text"
                value={envVar.key}
                onChange={(e) => handleEnvVarChange(index, "key", e.target.value)}
                placeholder="EXAMPLE_KEY"
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-300 placeholder-neutral-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
              />
              <input
                type={showValues ? "text" : "password"}
                value={envVar.value}
                onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                placeholder="secret-value"
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-sm text-neutral-300 placeholder-neutral-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => removeEnvVar(index)}
                className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors"
              >
                <MinusIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Add variable button */}
        <button
          type="button"
          onClick={addEnvVar}
          className="flex items-center gap-1.5 mt-3 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          <span>Add variable</span>
        </button>
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium rounded transition-colors"
        >
          {saving ? "Saving..." : "Save setup"}
        </button>
      </div>
    </div>
  );
}

export default ConfigureWorkspace;
