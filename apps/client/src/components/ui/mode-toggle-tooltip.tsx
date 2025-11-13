import { cn } from "@/lib/utils";
import { Switch } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { Cloud, HardDrive } from "lucide-react";
import * as React from "react";

interface ModeToggleTooltipProps {
  isCloudMode: boolean;
  onToggle: () => void;
  className?: string;
  disabled?: boolean;
}

export function ModeToggleTooltip({
  isCloudMode,
  onToggle,
  className,
  disabled = false,
}: ModeToggleTooltipProps) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (disabled) return;
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Simply toggle the mode without any waitlist checks
    onToggle();

    setShowTooltip(true);

    // Hide tooltip after 2 seconds
    timeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 2000);
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    // Hide tooltip on mouse leave
    setShowTooltip(false);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <Switch
        isSelected={isCloudMode}
        onValueChange={() => handleClick()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        color="primary"
        size="sm"
        isDisabled={disabled}
        aria-label={isCloudMode ? "Cloud mode" : "Local mode"}
        thumbIcon={({ isSelected, className }) =>
          isSelected ? (
            <Cloud className={cn(className, "size-3")} />
          ) : (
            <HardDrive className={cn(className, "size-3")} />
          )
        }
        classNames={{
          wrapper: cn(
            "group-data-[selected=true]:bg-blue-500",
            "group-data-[selected=true]:border-blue-500"
          ),
        }}
      />

      {/* Custom tooltip */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full left-1/2 -translate-x-1/2 z-[var(--z-modal)] mt-2"
          >
            {/* Arrow pointing up - matching shadcn style */}
            <div className="absolute left-[calc(50%_-4px)] translate-y-[calc(-50%_+1px)] size-2.5 rounded-[2px] rotate-45 bg-black" />
            <div
              className={cn(
                "relative px-3 py-1.5",
                "bg-black text-white text-xs rounded-md overflow-hidden w-24 whitespace-nowrap"
              )}
            >
              <div className="relative h-4 flex items-center w-full select-none">
                <div className="relative w-full flex">
                  <motion.div
                    className="flex items-center justify-center absolute inset-0 will-change-transform"
                    initial={false}
                    // animate={{ x: isCloudMode ? "-150%" : "0%" }}
                    animate={{ x: isCloudMode ? "0%" : "150%" }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    <span className="text-center">Cloud Mode</span>
                  </motion.div>
                  <motion.div
                    className="flex items-center justify-center absolute inset-0 will-change-transform"
                    initial={false}
                    // animate={{ x: isCloudMode ? "0%" : "150%" }}
                    animate={{ x: isCloudMode ? "-150%" : "0%" }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    <span className="text-center">Local Mode</span>
                  </motion.div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
