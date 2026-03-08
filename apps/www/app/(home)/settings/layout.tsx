"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ArrowLeft, Settings, Key, Cpu } from "lucide-react";

const navItems = [
  {
    name: "General",
    href: "/settings/general",
    icon: Settings,
  },
  {
    name: "AI Providers",
    href: "/settings/providers",
    icon: Key,
  },
  {
    name: "Models",
    href: "/settings/models",
    icon: Cpu,
  },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      {/* Left Sidebar */}
      <aside className="w-60 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col">
        <div className="p-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to app
          </Link>
        </div>

        <nav className="flex-1 px-3 py-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href === "/settings/providers" && pathname === "/settings");
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition mb-1",
                  isActive
                    ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 hover:text-neutral-900 dark:hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-8 py-4">
            <h1 className="text-lg font-medium text-neutral-900 dark:text-white text-center">
              Settings
            </h1>
          </div>

          {/* Content */}
          <div className="p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
