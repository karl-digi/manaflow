import type { ReactNode } from "react";

import { LightModeEnforcer } from "@/components/pr/light-mode-enforcer";

export default function PrReviewLayout({ children }: { children: ReactNode }) {
  return (
    <LightModeEnforcer>
      <div className="min-h-dvh bg-white font-sans text-neutral-900">
        {children}
      </div>
    </LightModeEnforcer>
  );
}
