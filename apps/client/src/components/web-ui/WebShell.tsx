import type { ReactNode } from "react";

interface WebShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function WebShell({ sidebar, children }: WebShellProps) {
  return (
    <div className="relative min-h-dvh bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(8,47,73,0.08),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.7),transparent_55%)]" />

      <div className="relative flex h-dvh min-h-dvh flex-col md:flex-row">
        {sidebar}

        <main className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
