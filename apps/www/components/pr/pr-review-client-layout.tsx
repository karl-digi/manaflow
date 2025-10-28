'use client';

import type { ReactNode } from "react";

import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { PrReviewThemeProvider } from "@/components/pr/pr-review-theme-provider";

export function PrReviewClientLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexClientProvider>
      <PrReviewThemeProvider>{children}</PrReviewThemeProvider>
    </ConvexClientProvider>
  );
}
