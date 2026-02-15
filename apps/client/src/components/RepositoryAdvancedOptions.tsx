import { type SandboxPreset } from "@cmux/shared";
import { getApiConfigSandboxOptions } from "@cmux/www-openapi-client/react-query";
import type { SandboxConfig } from "@cmux/www-openapi-client";
import { Accordion, AccordionItem } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Label, Radio, RadioGroup } from "react-aria-components";

export interface RepositoryAdvancedOptionsProps {
  /** Currently selected snapshot/preset ID */
  selectedSnapshotId?: string;
  /** Callback when user selects a different preset */
  onSnapshotChange: (snapshotId: string) => void;
}

export function RepositoryAdvancedOptions({
  selectedSnapshotId,
  onSnapshotChange,
}: RepositoryAdvancedOptionsProps) {
  const { data: config, isLoading, error } = useQuery(getApiConfigSandboxOptions());

  // Use the first preset as default if none selected
  const effectiveSnapshotId = selectedSnapshotId ?? config?.defaultPresetId;

  // Handle loading and error states
  if (isLoading) {
    return (
      <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace options...
        </div>
      </div>
    );
  }

  if (error || !config) {
    // Silently fail - advanced options are optional
    console.error("Failed to load sandbox config:", error);
    return null;
  }

  return (
    <RepositoryAdvancedOptionsInner
      config={config}
      selectedSnapshotId={effectiveSnapshotId}
      onSnapshotChange={onSnapshotChange}
    />
  );
}

interface RepositoryAdvancedOptionsInnerProps {
  config: SandboxConfig;
  selectedSnapshotId?: string;
  onSnapshotChange: (snapshotId: string) => void;
}

function RepositoryAdvancedOptionsInner({
  config,
  selectedSnapshotId,
  onSnapshotChange,
}: RepositoryAdvancedOptionsInnerProps) {
  const { presets, defaultPresetId } = config;

  // Fall back to default if current selection is not in available presets
  const effectiveSnapshotId =
    presets.find((p: SandboxPreset) => p.id === selectedSnapshotId)?.id ?? defaultPresetId;

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
      <Accordion
        selectionMode="multiple"
        className="px-0"
        defaultExpandedKeys={[]}
        itemClasses={{
          trigger:
            "text-sm cursor-pointer py-2 px-3 transition-colors data-[hovered=true]:bg-neutral-50 dark:data-[hovered=true]:bg-neutral-900 rounded-none",
          content:
            "pt-0 px-3 pb-3 border-t border-neutral-200 dark:border-neutral-800",
          title: "text-sm font-medium",
        }}
      >
        <AccordionItem
          key="advanced-options"
          aria-label="Advanced options"
          title="Advanced options"
        >
          <div className="space-y-4 pt-1.5">
            <RadioGroup
              value={effectiveSnapshotId}
              onChange={(value) => onSnapshotChange(value)}
              className="space-y-4"
            >
              <Label className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                Machine size
              </Label>
              <div className="grid gap-3 sm:grid-cols-2 pt-1.5">
                {presets.map((preset: SandboxPreset) => (
                  <PresetRadioOption
                    key={preset.id}
                    preset={preset}
                    isSelected={preset.id === effectiveSnapshotId}
                  />
                ))}
              </div>
            </RadioGroup>
          </div>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

interface PresetRadioOptionProps {
  preset: SandboxPreset;
  isSelected: boolean;
}

function PresetRadioOption({ preset, isSelected }: PresetRadioOptionProps) {
  return (
    <Radio
      value={preset.id}
      className={({ isFocusVisible, isDisabled }) => {
        const baseClasses =
          "relative flex h-full cursor-pointer flex-col justify-between rounded-lg border px-4 py-3 text-left transition-colors focus:outline-none";
        const stateClasses = [
          isSelected
            ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-900"
            : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:border-neutral-300 dark:hover:border-neutral-700",
          isFocusVisible
            ? "outline-2 outline-offset-2 outline-neutral-500"
            : "",
          isDisabled ? "cursor-not-allowed opacity-60" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `${baseClasses} ${stateClasses}`.trim();
      }}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {preset.label}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
              <span>{preset.cpu}</span>
              <span>{preset.memory}</span>
              <span>{preset.disk}</span>
            </div>
          </div>
          <span
            className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
              isSelected
                ? "border-neutral-900 dark:border-neutral-100 bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "border-neutral-300 dark:border-neutral-700 bg-white text-transparent dark:bg-neutral-950"
            }`}
          >
            <Check className="h-3 w-3" aria-hidden="true" />
          </span>
        </div>
        {preset.description ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {preset.description}
          </p>
        ) : null}
      </div>
    </Radio>
  );
}
