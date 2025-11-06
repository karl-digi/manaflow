/**
 * Example usage of the Electron settings API
 *
 * This demonstrates how to use the new settings system to toggle
 * the allowDraftReleases feature for auto-updates.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";

export function ElectronSettingsExample() {
  const [allowDraftReleases, setAllowDraftReleases] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    if (!window.cmux?.settings) {
      console.warn("cmux.settings API not available (not running in Electron)");
      setIsLoading(false);
      return;
    }

    window.cmux.settings
      .get()
      .then((result) => {
        if (result.ok && result.settings) {
          setAllowDraftReleases(result.settings.allowDraftReleases);
        } else {
          console.error("Failed to load settings:", result.reason);
          toast.error("Failed to load settings");
        }
      })
      .catch((error) => {
        console.error("Error loading settings:", error);
        toast.error("Error loading settings");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // Update setting
  const handleToggle = async (enabled: boolean) => {
    if (!window.cmux?.settings) {
      toast.error("Settings API not available");
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.cmux.settings.update({
        allowDraftReleases: enabled,
      });

      if (result.ok) {
        setAllowDraftReleases(enabled);
        toast.success(
          enabled
            ? "Draft releases enabled - app will update to pre-release versions"
            : "Draft releases disabled - app will only update to stable releases"
        );
      } else {
        console.error("Failed to update setting:", result.reason);
        toast.error("Failed to update setting");
      }
    } catch (error) {
      console.error("Error updating setting:", error);
      toast.error("Error updating setting");
    } finally {
      setIsLoading(false);
    }
  };

  if (!window.cmux?.settings) {
    return (
      <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          Settings API not available (not running in Electron)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Auto-Update Settings
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          Configure how cmux checks for updates
        </p>
      </div>

      <div className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <label
              htmlFor="draft-releases"
              className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
            >
              Enable Draft Releases
            </label>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              When enabled, cmux will automatically update to the latest draft
              releases on GitHub, even before they are officially published.
              This allows you to get the newest features and fixes immediately.
            </p>
          </div>
          <div className="ml-4">
            <button
              id="draft-releases"
              type="button"
              role="switch"
              aria-checked={allowDraftReleases}
              disabled={isLoading}
              onClick={() => handleToggle(!allowDraftReleases)}
              className={`
                relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
                ${allowDraftReleases ? "bg-blue-600" : "bg-neutral-200 dark:bg-neutral-700"}
              `}
            >
              <span
                className={`
                  pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                  transition duration-200 ease-in-out
                  ${allowDraftReleases ? "translate-x-5" : "translate-x-0"}
                `}
              />
            </button>
          </div>
        </div>

        {allowDraftReleases && (
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Draft releases are enabled. The app will check for updates
              including pre-release versions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
