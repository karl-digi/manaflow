"use client";

import { isElectron } from "@/lib/electron";
import { getElectronBridge } from "@/lib/electron";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import { SignIn, useUser } from "@stackframe/react";
import { AnimatePresence, motion } from "framer-motion";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, ExternalLink, X } from "lucide-react";

type SignInState =
  | { kind: "idle" }
  | { kind: "awaiting-browser"; sessionId: string }
  | { kind: "embedded" };

export function SignInComponent() {
  const user = useUser({ or: "return-null" });
  const showSignIn = !user;
  const [state, setState] = useState<SignInState>({ kind: "idle" });
  const [protocolStatus, setProtocolStatus] = useState<
    | { ok: true; isPackaged: boolean; isDefaultProtocolClient: boolean }
    | { ok: false; error: string }
    | null
  >(null);

  // Track the current session to prevent stale callbacks
  const currentSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = getElectronBridge();
    if (!bridge?.app?.getProtocolStatus) return;

    bridge.app
      .getProtocolStatus()
      .then((res) => {
        setProtocolStatus(res);
      })
      .catch((error: unknown) => {
        console.error("[SignIn] Failed to get protocol status:", error);
        setProtocolStatus({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  const browserSignInSupported = useMemo(() => {
    if (!isElectron) return true;
    if (!protocolStatus) return true; // optimistic until we know otherwise
    if (!protocolStatus.ok) return true;
    return protocolStatus.isDefaultProtocolClient;
  }, [protocolStatus]);

  // GitHub Desktop pattern: generate session ID, store it, open browser
  const handleSignInWithBrowser = useCallback(() => {
    if (!browserSignInSupported) return;

    // Generate unique session ID (like CSRF token in GitHub Desktop)
    const sessionId = crypto.randomUUID();
    currentSessionRef.current = sessionId;

    setState({ kind: "awaiting-browser", sessionId });

    // Open browser for sign-in
    const url = `${WWW_ORIGIN}/handler/sign-in?force=true`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [browserSignInSupported]);

  // Cancel resets state and invalidates current session
  const handleCancel = useCallback(() => {
    currentSessionRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const handleUseEmbedded = useCallback(() => {
    currentSessionRef.current = null;
    setState({ kind: "embedded" });
  }, []);

  // Reset state when user signs in successfully
  useEffect(() => {
    if (!showSignIn) {
      currentSessionRef.current = null;
      setState({ kind: "idle" });
    }
  }, [showSignIn]);

  const showEmbeddedSignIn =
    !isElectron || import.meta.env.DEV || !browserSignInSupported;

  const isAwaitingBrowser = state.kind === "awaiting-browser";

  return (
    <AnimatePresence mode="wait">
      {showSignIn ? (
        <motion.div
          key="signin"
          className="absolute inset-0 w-screen h-dvh flex items-center justify-center bg-white dark:bg-black z-[var(--z-global-blocking)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {isElectron ? (
            <div
              className="absolute top-0 left-0 right-0 h-[24px]"
              style={{ WebkitAppRegion: "drag" } as CSSProperties}
            />
          ) : null}
          {isElectron ? (
            <AnimatePresence mode="wait">
              {(state.kind === "idle" || state.kind === "awaiting-browser") && (
                <motion.div
                  key="browser-flow"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="relative flex flex-col items-center gap-6 p-8 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg max-w-md w-[400px]"
                >
                  {/* Close button when awaiting */}
                  {isAwaitingBrowser && (
                    <button
                      onClick={handleCancel}
                      className="absolute top-4 right-4 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      aria-label="Cancel"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}

                  {/* Icon - Globe or Spinner */}
                  <div className="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    {isAwaitingBrowser ? (
                      <div className="w-8 h-8 rounded-full border-2 border-neutral-300 dark:border-neutral-600 border-t-neutral-900 dark:border-t-white animate-spin" />
                    ) : (
                      <Globe className="w-8 h-8 text-neutral-600 dark:text-neutral-400" />
                    )}
                  </div>

                  {/* Title and description */}
                  <div className="text-center space-y-2">
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                      {isAwaitingBrowser
                        ? "Waiting for Browser..."
                        : "Sign in Using Your Browser"}
                    </h2>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                      {isAwaitingBrowser
                        ? "Complete sign-in in your browser. Click \"Open Manaflow\" after signing in to return here."
                        : "Your browser will redirect you back to Manaflow once you've signed in. If your browser asks for permission to launch Manaflow, please allow it."}
                    </p>
                  </div>

                  {/* Warning if protocol not registered */}
                  {!browserSignInSupported && !isAwaitingBrowser && (
                    <div className="w-full p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        The <code className="font-mono">manaflow://</code>{" "}
                        deeplink is not registered. Restart Manaflow to
                        re-register, or use embedded sign-in.
                      </p>
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex flex-col w-full gap-3">
                    <button
                      onClick={handleSignInWithBrowser}
                      disabled={!browserSignInSupported || isAwaitingBrowser}
                      className={`w-full px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                        isAwaitingBrowser
                          ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-wait"
                          : browserSignInSupported
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100"
                            : "bg-neutral-300 text-neutral-500 cursor-not-allowed dark:bg-neutral-700 dark:text-neutral-500"
                      }`}
                    >
                      {isAwaitingBrowser ? (
                        <>
                          <div className="w-4 h-4 rounded-full border-2 border-neutral-400 border-t-neutral-600 animate-spin" />
                          Waiting for sign-in...
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4" />
                          Sign in with Browser
                        </>
                      )}
                    </button>

                    {isAwaitingBrowser ? (
                      <button
                        onClick={handleCancel}
                        className="w-full px-4 py-2.5 rounded-lg font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        Cancel
                      </button>
                    ) : (
                      showEmbeddedSignIn && (
                        <button
                          onClick={handleUseEmbedded}
                          className="w-full px-4 py-2.5 rounded-lg font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                        >
                          Sign in here instead
                        </button>
                      )
                    )}
                  </div>
                </motion.div>
              )}

              {state.kind === "embedded" && (
                <motion.div
                  key="embedded"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col items-center gap-4"
                >
                  <SignIn />
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 rounded-lg font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-sm"
                  >
                    Back to browser sign-in
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            <SignIn />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
