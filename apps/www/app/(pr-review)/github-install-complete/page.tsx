"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export default function GitHubInstallCompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRedirecting, setIsRedirecting] = useState(true);
  const [returnPath, setReturnPath] = useState<string | null>(null);

  useEffect(() => {
    console.log("[GitHub Install Complete] Checking for return URL...");

    // Priority 1: Check if there's a stored return URL from PR review
    const returnUrl = sessionStorage.getItem("pr_review_return_url");
    console.log("[GitHub Install Complete] Found return URL:", returnUrl);

    if (returnUrl) {
      // Clear the stored URL
      sessionStorage.removeItem("pr_review_return_url");

      // Extract the path from the full URL
      try {
        const url = new URL(returnUrl);
        const path = url.pathname + url.search + url.hash;
        console.log("[GitHub Install Complete] Redirecting to:", path);
        setReturnPath(path);

        // Wait a moment before redirecting to show the success message
        setTimeout(() => {
          router.push(path);
        }, 1500);
        return;
      } catch (error) {
        console.error("Failed to parse return URL:", error);
      }
    }

    // Priority 2: Try Electron deep link (for Electron app users)
    const team = searchParams.get("team");
    if (team) {
      try {
        const deepLink = `cmux://github-connect-complete?team=${encodeURIComponent(team)}`;
        window.location.href = deepLink;

        // Wait a moment, then show manual message if deep link didn't work
        setTimeout(() => {
          setIsRedirecting(false);
        }, 2000);
        return;
      } catch (error) {
        console.error("Failed to open deep link:", error);
      }
    }

    // No return URL or team, show manual message
    setIsRedirecting(false);
  }, [router, searchParams]);

  if (isRedirecting) {
    return (
      <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto mb-6 grid place-items-center">
            <div className="h-14 w-14 rounded-full bg-neutral-100 ring-8 ring-neutral-50 grid place-items-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Installation Complete
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {returnPath
              ? "Redirecting you back to the pull request..."
              : "Opening cmux app..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-neutral-900">
                GitHub App Installed Successfully
              </h1>
              <p className="mt-3 text-base text-neutral-600 leading-relaxed">
                The cmux-agent has been installed and configured for your repository.
                You can now return to the pull request page to continue your review.
              </p>

              <div className="mt-6 rounded-lg bg-neutral-50 p-4 border border-neutral-200">
                <p className="text-sm text-neutral-700">
                  <span className="font-semibold">Next steps:</span>
                </p>
                <ol className="mt-2 space-y-1 text-sm text-neutral-600">
                  <li>1. Use your browser&apos;s back button to return to the pull request page</li>
                  <li>2. Or close this tab and navigate back to the PR you were viewing</li>
                  <li>3. Refresh the page to reload with your new permissions</li>
                  <li>4. You should now be able to view the pull request</li>
                </ol>
              </div>

              <button
                onClick={() => window.history.back()}
                className="mt-4 w-full inline-flex items-center justify-center gap-3 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
