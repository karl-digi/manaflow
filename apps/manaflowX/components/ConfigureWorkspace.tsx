"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback, useEffect } from "react";
import type { Id } from "@/convex/_generated/dataModel";

// Icons
function ChevronDownIcon({ className }: { className?: string }) {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

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

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
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
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
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
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
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
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
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
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

interface Script {
  name: string;
  command: string;
  description?: string;
}

interface EnvVar {
  key: string;
  value: string;
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-neutral-900 hover:bg-neutral-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-neutral-400">{icon}</span>
          <span className="text-sm font-medium text-neutral-100">{title}</span>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 text-neutral-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {isOpen && (
        <div className="border-t border-neutral-800 bg-neutral-950 p-4">
          {children}
        </div>
      )}
    </div>
  );
}

interface ScriptEditorProps {
  scripts: Script[];
  onScriptsChange: (scripts: Script[]) => void;
  placeholder?: string;
}

function ScriptEditor({
  scripts,
  onScriptsChange,
  placeholder = "npm run dev",
}: ScriptEditorProps) {
  const addScript = useCallback(() => {
    onScriptsChange([...scripts, { name: "", command: "", description: "" }]);
  }, [scripts, onScriptsChange]);

  const updateScript = useCallback(
    (index: number, field: keyof Script, value: string) => {
      const updated = [...scripts];
      updated[index] = { ...updated[index], [field]: value };
      onScriptsChange(updated);
    },
    [scripts, onScriptsChange]
  );

  const removeScript = useCallback(
    (index: number) => {
      onScriptsChange(scripts.filter((_, i) => i !== index));
    },
    [scripts, onScriptsChange]
  );

  return (
    <div className="space-y-3">
      {scripts.map((script, index) => (
        <div
          key={index}
          className="flex gap-2 items-start p-3 bg-neutral-900 rounded-lg border border-neutral-800"
        >
          <div className="flex-1 space-y-2">
            <input
              type="text"
              value={script.name}
              onChange={(e) => updateScript(index, "name", e.target.value)}
              placeholder="Script name"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="flex items-center gap-2">
              <span className="text-neutral-500 text-xs font-mono">$</span>
              <input
                type="text"
                value={script.command}
                onChange={(e) => updateScript(index, "command", e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <input
              type="text"
              value={script.description || ""}
              onChange={(e) =>
                updateScript(index, "description", e.target.value)
              }
              placeholder="Description (optional)"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-400 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="button"
            onClick={() => removeScript(index)}
            className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addScript}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-md transition-colors"
      >
        <PlusIcon className="h-4 w-4" />
        <span>Add script</span>
      </button>
    </div>
  );
}

interface EnvVarEditorProps {
  envVars: EnvVar[];
  onEnvVarsChange: (envVars: EnvVar[]) => void;
}

function EnvVarEditor({ envVars, onEnvVarsChange }: EnvVarEditorProps) {
  const addEnvVar = useCallback(() => {
    onEnvVarsChange([...envVars, { key: "", value: "" }]);
  }, [envVars, onEnvVarsChange]);

  const updateEnvVar = useCallback(
    (index: number, field: keyof EnvVar, value: string) => {
      const updated = [...envVars];
      updated[index] = { ...updated[index], [field]: value };
      onEnvVarsChange(updated);
    },
    [envVars, onEnvVarsChange]
  );

  const removeEnvVar = useCallback(
    (index: number) => {
      onEnvVarsChange(envVars.filter((_, i) => i !== index));
    },
    [envVars, onEnvVarsChange]
  );

  return (
    <div className="space-y-3">
      {envVars.map((envVar, index) => (
        <div
          key={index}
          className="flex gap-2 items-center p-3 bg-neutral-900 rounded-lg border border-neutral-800"
        >
          <input
            type="text"
            value={envVar.key}
            onChange={(e) => updateEnvVar(index, "key", e.target.value)}
            placeholder="KEY"
            className="w-1/3 bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="text-neutral-500">=</span>
          <input
            type="password"
            value={envVar.value}
            onChange={(e) => updateEnvVar(index, "value", e.target.value)}
            placeholder="value"
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => removeEnvVar(index)}
            className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addEnvVar}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-md transition-colors"
      >
        <PlusIcon className="h-4 w-4" />
        <span>Add environment variable</span>
      </button>
      <p className="text-xs text-neutral-500 mt-2">
        Environment variables will not be saved to the database for security
        reasons.
      </p>
    </div>
  );
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
  const updateDevScripts = useMutation(api.workspaceConfig.updateDevScripts);
  const updateMaintenanceScripts = useMutation(
    api.workspaceConfig.updateMaintenanceScripts
  );
  const updateSetupScripts = useMutation(
    api.workspaceConfig.updateSetupScripts
  );

  // Local state
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [setupScripts, setSetupScripts] = useState<Script[]>([]);
  const [devScripts, setDevScripts] = useState<Script[]>([]);
  const [maintenanceScripts, setMaintenanceScripts] = useState<Script[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  // Load from existing config
  useEffect(() => {
    if (existingConfig) {
      setSetupScripts(existingConfig.setupScripts || []);
      setDevScripts(existingConfig.devScripts || []);
      setMaintenanceScripts(existingConfig.maintenanceScripts || []);
    }
  }, [existingConfig]);

  // Save handlers with debounce
  const handleSaveSetupScripts = useCallback(
    async (scripts: Script[]) => {
      setSetupScripts(scripts);
      setSaving("setup");
      try {
        await updateSetupScripts({ repoId, setupScripts: scripts });
      } finally {
        setSaving(null);
      }
    },
    [repoId, updateSetupScripts]
  );

  const handleSaveDevScripts = useCallback(
    async (scripts: Script[]) => {
      setDevScripts(scripts);
      setSaving("dev");
      try {
        await updateDevScripts({ repoId, devScripts: scripts });
      } finally {
        setSaving(null);
      }
    },
    [repoId, updateDevScripts]
  );

  const handleSaveMaintenanceScripts = useCallback(
    async (scripts: Script[]) => {
      setMaintenanceScripts(scripts);
      setSaving("maintenance");
      try {
        await updateMaintenanceScripts({ repoId, maintenanceScripts: scripts });
      } finally {
        setSaving(null);
      }
    },
    [repoId, updateMaintenanceScripts]
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Environment Variables (UI only, not saved) */}
      <CollapsibleSection
        title="Environment Variables"
        icon={<KeyIcon className="h-4 w-4" />}
      >
        <EnvVarEditor envVars={envVars} onEnvVarsChange={setEnvVars} />
      </CollapsibleSection>

      {/* Setup Scripts */}
      <CollapsibleSection
        title={`Setup Scripts${saving === "setup" ? " (saving...)" : ""}`}
        icon={<SettingsIcon className="h-4 w-4" />}
      >
        <p className="text-xs text-neutral-500 mb-3">
          Scripts to run once during initial workspace setup.
        </p>
        <ScriptEditor
          scripts={setupScripts}
          onScriptsChange={handleSaveSetupScripts}
          placeholder="npm install"
        />
      </CollapsibleSection>

      {/* Dev Scripts */}
      <CollapsibleSection
        title={`Dev Scripts${saving === "dev" ? " (saving...)" : ""}`}
        icon={<TerminalIcon className="h-4 w-4" />}
        defaultOpen
      >
        <p className="text-xs text-neutral-500 mb-3">
          Scripts for development tasks like starting servers or watching files.
        </p>
        <ScriptEditor
          scripts={devScripts}
          onScriptsChange={handleSaveDevScripts}
          placeholder="npm run dev"
        />
      </CollapsibleSection>

      {/* Maintenance Scripts */}
      <CollapsibleSection
        title={`Maintenance Scripts${saving === "maintenance" ? " (saving...)" : ""}`}
        icon={<WrenchIcon className="h-4 w-4" />}
      >
        <p className="text-xs text-neutral-500 mb-3">
          Scripts for maintenance tasks like database migrations or cleanups.
        </p>
        <ScriptEditor
          scripts={maintenanceScripts}
          onScriptsChange={handleSaveMaintenanceScripts}
          placeholder="npm run migrate"
        />
      </CollapsibleSection>
    </div>
  );
}

export default ConfigureWorkspace;
