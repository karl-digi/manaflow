import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";

type DeleteButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const DeleteButton = forwardRef<HTMLButtonElement, DeleteButtonProps>(
  ({ className, disabled, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      type={type}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        !disabled && "hover:bg-red-100 dark:hover:bg-red-950/40",
        className,
      )}
      {...props}
    />
  ),
);

DeleteButton.displayName = "DeleteButton";
