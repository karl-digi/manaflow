import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { TourStep } from "@/hooks/useOnboardingTour";

interface OnboardingTourProps {
  isActive: boolean;
  currentStep: TourStep | null;
  currentStepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: "top" | "bottom" | "left" | "right";
}

const TOOLTIP_OFFSET = 12;
const SPOTLIGHT_PADDING = 8;

function calculateTooltipPosition(
  targetRect: ElementRect,
  tooltipRect: { width: number; height: number },
  preferredPlacement: "top" | "bottom" | "left" | "right" = "bottom"
): TooltipPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Calculate center of target
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  // Check available space in each direction
  const spaceTop = targetRect.top - SPOTLIGHT_PADDING;
  const spaceBottom =
    viewportHeight - (targetRect.top + targetRect.height + SPOTLIGHT_PADDING);
  const spaceLeft = targetRect.left - SPOTLIGHT_PADDING;
  const spaceRight =
    viewportWidth - (targetRect.left + targetRect.width + SPOTLIGHT_PADDING);

  // Determine best placement
  let placement = preferredPlacement;

  // Check if preferred placement fits
  const needsHeight = tooltipRect.height + TOOLTIP_OFFSET;
  const needsWidth = tooltipRect.width + TOOLTIP_OFFSET;

  if (
    (placement === "bottom" && spaceBottom < needsHeight) ||
    (placement === "top" && spaceTop < needsHeight) ||
    (placement === "left" && spaceLeft < needsWidth) ||
    (placement === "right" && spaceRight < needsWidth)
  ) {
    // Find best alternative
    const spaces = [
      { placement: "bottom" as const, space: spaceBottom, needs: needsHeight },
      { placement: "top" as const, space: spaceTop, needs: needsHeight },
      { placement: "right" as const, space: spaceRight, needs: needsWidth },
      { placement: "left" as const, space: spaceLeft, needs: needsWidth },
    ];

    const validSpace = spaces.find((s) => s.space >= s.needs);
    if (validSpace) {
      placement = validSpace.placement;
    } else {
      // Default to placement with most space
      const sorted = spaces.sort(
        (a, b) => b.space / b.needs - a.space / a.needs
      );
      placement = sorted[0].placement;
    }
  }

  let top: number;
  let left: number;

  switch (placement) {
    case "top":
      top = targetRect.top - SPOTLIGHT_PADDING - tooltipRect.height - TOOLTIP_OFFSET;
      left = targetCenterX - tooltipRect.width / 2;
      break;
    case "bottom":
      top = targetRect.top + targetRect.height + SPOTLIGHT_PADDING + TOOLTIP_OFFSET;
      left = targetCenterX - tooltipRect.width / 2;
      break;
    case "left":
      top = targetCenterY - tooltipRect.height / 2;
      left = targetRect.left - SPOTLIGHT_PADDING - tooltipRect.width - TOOLTIP_OFFSET;
      break;
    case "right":
      top = targetCenterY - tooltipRect.height / 2;
      left = targetRect.left + targetRect.width + SPOTLIGHT_PADDING + TOOLTIP_OFFSET;
      break;
  }

  // Clamp to viewport
  left = Math.max(16, Math.min(left, viewportWidth - tooltipRect.width - 16));
  top = Math.max(16, Math.min(top, viewportHeight - tooltipRect.height - 16));

  return { top, left, placement };
}

export function OnboardingTour({
  isActive,
  currentStep,
  currentStepIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: OnboardingTourProps) {
  const [targetRect, setTargetRect] = useState<ElementRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isPositioned, setIsPositioned] = useState(false);

  // Find and track target element
  useLayoutEffect(() => {
    if (!isActive || !currentStep) {
      setTargetRect(null);
      setIsPositioned(false);
      return;
    }

    const updateTargetRect = () => {
      const element = document.querySelector(currentStep.target);
      if (element) {
        const rect = element.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setTargetRect(null);
      }
    };

    // Initial update
    updateTargetRect();

    // Watch for DOM changes and scroll
    const resizeObserver = new ResizeObserver(updateTargetRect);
    const element = document.querySelector(currentStep.target);
    if (element) {
      resizeObserver.observe(element);
    }

    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect, true);
    };
  }, [isActive, currentStep]);

  // Calculate tooltip position after it renders
  useLayoutEffect(() => {
    if (!targetRect || !tooltipRef.current) {
      setIsPositioned(false);
      return;
    }

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const position = calculateTooltipPosition(
      targetRect,
      { width: tooltipRect.width, height: tooltipRect.height },
      currentStep?.placement
    );
    setTooltipPosition(position);
    setIsPositioned(true);
  }, [targetRect, currentStep?.placement]);

  // Scroll target into view
  useEffect(() => {
    if (!isActive || !currentStep) return;

    const element = document.querySelector(currentStep.target);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isActive, currentStep]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle clicks on the backdrop itself
      if (e.target === e.currentTarget) {
        onSkip();
      }
    },
    [onSkip]
  );

  if (!isActive || !currentStep) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isActive && (
        <>
          {/* Backdrop with spotlight cutout */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[9998]"
            onClick={handleBackdropClick}
            style={{
              background: targetRect
                ? `radial-gradient(ellipse ${targetRect.width + SPOTLIGHT_PADDING * 2}px ${targetRect.height + SPOTLIGHT_PADDING * 2}px at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px, transparent 0%, transparent 100%), rgba(0, 0, 0, 0.75)`
                : "rgba(0, 0, 0, 0.75)",
            }}
          >
            {/* Spotlight cutout using clip-path for better performance */}
            {targetRect && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  clipPath: `polygon(
                    0% 0%,
                    0% 100%,
                    ${targetRect.left - SPOTLIGHT_PADDING}px 100%,
                    ${targetRect.left - SPOTLIGHT_PADDING}px ${targetRect.top - SPOTLIGHT_PADDING}px,
                    ${targetRect.left + targetRect.width + SPOTLIGHT_PADDING}px ${targetRect.top - SPOTLIGHT_PADDING}px,
                    ${targetRect.left + targetRect.width + SPOTLIGHT_PADDING}px ${targetRect.top + targetRect.height + SPOTLIGHT_PADDING}px,
                    ${targetRect.left - SPOTLIGHT_PADDING}px ${targetRect.top + targetRect.height + SPOTLIGHT_PADDING}px,
                    ${targetRect.left - SPOTLIGHT_PADDING}px 100%,
                    100% 100%,
                    100% 0%
                  )`,
                  background: "rgba(0, 0, 0, 0.75)",
                }}
              />
            )}
          </motion.div>

          {/* Spotlight highlight ring */}
          {targetRect && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed z-[9999] pointer-events-none rounded-lg ring-2 ring-blue-500 ring-offset-2 ring-offset-transparent"
              style={{
                top: targetRect.top - SPOTLIGHT_PADDING,
                left: targetRect.left - SPOTLIGHT_PADDING,
                width: targetRect.width + SPOTLIGHT_PADDING * 2,
                height: targetRect.height + SPOTLIGHT_PADDING * 2,
                boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.75)",
              }}
            />
          )}

          {/* Tooltip */}
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: isPositioned ? 1 : 0, y: isPositioned ? 0 : 10 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "fixed z-[10000] w-80 bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700",
              !isPositioned && "invisible"
            )}
            style={{
              top: tooltipPosition?.top ?? 0,
              left: tooltipPosition?.left ?? 0,
            }}
          >
            {/* Close button */}
            <button
              onClick={onSkip}
              className="absolute top-3 right-3 p-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              aria-label="Skip tour"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Content */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-blue-500 dark:text-blue-400">
                  Step {currentStepIndex + 1} of {totalSteps}
                </span>
              </div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                {currentStep.title}
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                {currentStep.description}
              </p>
            </div>

            {/* Progress and navigation */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 rounded-b-xl">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalSteps }).map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "w-1.5 h-1.5 rounded-full transition-colors",
                      index === currentStepIndex
                        ? "bg-blue-500"
                        : index < currentStepIndex
                          ? "bg-blue-300 dark:bg-blue-600"
                          : "bg-neutral-300 dark:bg-neutral-600"
                    )}
                  />
                ))}
              </div>

              {/* Navigation buttons */}
              <div className="flex items-center gap-2">
                {currentStepIndex > 0 && (
                  <button
                    onClick={onPrev}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                )}
                <button
                  onClick={onNext}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                >
                  {currentStepIndex === totalSteps - 1 ? "Finish" : "Next"}
                  {currentStepIndex < totalSteps - 1 && (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
