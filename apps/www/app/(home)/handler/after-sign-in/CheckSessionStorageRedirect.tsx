"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { OpenCmuxClient } from "./OpenCmuxClient";

const OAUTH_CALLBACK_KEY = "oauth_callback_url";
const CMUX_SCHEME = "cmux://";

type CheckSessionStorageRedirectProps = {
  fallbackPath: string;
};

export function CheckSessionStorageRedirect({
  fallbackPath,
}: CheckSessionStorageRedirectProps) {
  const router = useRouter();
  const [cmuxHref, setCmuxHref] = useState<string | null>(null);

  useEffect(() => {
    let redirectPath = fallbackPath;
    let isCmuxDeeplink = false;

    try {
      const storedCallback = sessionStorage.getItem(OAUTH_CALLBACK_KEY);
      if (storedCallback) {
        // Check if it's a cmux:// deeplink (for Electron)
        if (storedCallback.startsWith(CMUX_SCHEME)) {
          isCmuxDeeplink = true;
          redirectPath = storedCallback;
        }
        // Validate it's a relative path for security
        else if (storedCallback.startsWith("/") && !storedCallback.startsWith("//")) {
          redirectPath = storedCallback;
        }
        sessionStorage.removeItem(OAUTH_CALLBACK_KEY);
      }
    } catch {
      // sessionStorage not available
    }

    console.log("[CheckSessionStorageRedirect] Redirecting to:", redirectPath, { isCmuxDeeplink });

    if (isCmuxDeeplink) {
      // Use OpenCmuxClient for Electron deeplinks
      setCmuxHref(redirectPath);
    } else {
      router.replace(redirectPath);
    }
  }, [router, fallbackPath]);

  // If we have a cmux:// URL, render the OpenCmuxClient component
  if (cmuxHref) {
    return <OpenCmuxClient href={cmuxHref} />;
  }

  return (
    <div className="min-h-dvh bg-[#05050a] text-white flex items-center justify-center font-sans">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-400">Completing sign in...</p>
      </div>
    </div>
  );
}
