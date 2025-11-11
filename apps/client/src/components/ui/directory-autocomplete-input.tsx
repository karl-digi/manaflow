import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Folder } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSocket } from "@/contexts/socket/use-socket";

export interface DirectorySuggestion {
  name: string;
  fullPath: string;
}

export interface DirectoryAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  error?: string | null;
  autoFocus?: boolean;
  disabled?: boolean;
}

export function DirectoryAutocompleteInput({
  value,
  onChange,
  onSubmit,
  placeholder = "~/path/to/repo",
  className,
  error,
  autoFocus = false,
  disabled = false,
}: DirectoryAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<DirectorySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [homeDir, setHomeDir] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { socket } = useSocket();
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSuggestions = useCallback((partialPath: string) => {
    if (!socket) return;

    // Clear any pending fetch
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce the fetch to avoid too many requests
    fetchTimeoutRef.current = setTimeout(() => {
      socket.emit(
        "get-directory-suggestions",
        { partialPath },
        (response: {
          success: boolean;
          suggestions: DirectorySuggestion[];
          homeDir: string;
          error?: string;
        }) => {
          if (response.success) {
            setSuggestions(response.suggestions);
            setHomeDir(response.homeDir);
            setSelectedIndex(0);
          } else {
            setSuggestions([]);
          }
        }
      );
    }, 150);
  }, [socket]);

  useEffect(() => {
    // Fetch suggestions when value changes
    if (value && value.length > 0) {
      const startsWithPath = value.startsWith('/') || value.startsWith('~') || value.startsWith('./') || value.startsWith('../');
      if (startsWithPath) {
        fetchSuggestions(value);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } else if (value === '') {
      // Show home directory on empty input
      fetchSuggestions('~');
      setShowSuggestions(false);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [value, fetchSuggestions]);

  const handleSuggestionSelect = (suggestion: DirectorySuggestion) => {
    // Replace ~ with homeDir for display
    let displayPath = suggestion.fullPath;
    if (homeDir && suggestion.fullPath.startsWith(homeDir)) {
      displayPath = suggestion.fullPath.replace(homeDir, '~');
    }
    onChange(displayPath);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit?.();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSuggestionSelect(suggestions[selectedIndex]);
        } else {
          onSubmit?.();
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowSuggestions(false);
        break;
      case "Tab":
        if (suggestions.length > 0) {
          e.preventDefault();
          handleSuggestionSelect(suggestions[selectedIndex]);
        }
        break;
    }
  };

  return (
    <Popover.Root open={showSuggestions && suggestions.length > 0} onOpenChange={setShowSuggestions}>
      <Popover.Anchor asChild>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (value && suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          placeholder={placeholder}
          className={clsx(
            "flex-1 px-2 h-7 text-[13px] rounded border",
            "bg-white dark:bg-neutral-800",
            "border-neutral-300 dark:border-neutral-600",
            "text-neutral-900 dark:text-neutral-100",
            "placeholder:text-neutral-400 dark:placeholder:text-neutral-500",
            "focus:outline-none focus:ring-1 focus:ring-blue-500",
            error ? "border-red-500 dark:border-red-500" : "",
            disabled ? "opacity-50 cursor-not-allowed" : "",
            className
          )}
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={{ top: 12, bottom: 12 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={clsx(
            "z-[var(--z-modal)] rounded-md border overflow-hidden border-neutral-200 bg-white p-0 drop-shadow-lg outline-none",
            "dark:border-neutral-800 dark:bg-neutral-950",
            "w-[var(--radix-popover-trigger-width)] min-w-[300px] max-w-[500px]",
            "animate-in fade-in-0 zoom-in-95"
          )}
        >
          <Command shouldFilter={false}>
            <CommandList className="max-h-[200px] overflow-y-auto">
              {suggestions.length === 0 ? (
                <CommandEmpty className="px-3 py-2 text-[13px] text-neutral-500">
                  No directories found
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {suggestions.map((suggestion, index) => {
                    // Display path with ~ if it's in home directory
                    let displayPath = suggestion.fullPath;
                    if (homeDir && suggestion.fullPath.startsWith(homeDir)) {
                      displayPath = suggestion.fullPath.replace(homeDir, '~');
                    }

                    return (
                      <CommandItem
                        key={suggestion.fullPath}
                        value={suggestion.fullPath}
                        onSelect={() => handleSuggestionSelect(suggestion)}
                        className={clsx(
                          "flex items-center gap-2 text-[13px] py-1.5 px-2 cursor-pointer",
                          index === selectedIndex ? "bg-neutral-100 dark:bg-neutral-800" : ""
                        )}
                      >
                        <Folder className="w-4 h-4 text-blue-500 shrink-0" />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="truncate text-neutral-900 dark:text-neutral-100">
                            {suggestion.name}
                          </span>
                          <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                            {displayPath}
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
