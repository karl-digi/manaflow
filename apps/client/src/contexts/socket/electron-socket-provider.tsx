import { CmuxIpcSocketClient } from "@/lib/cmux-ipc-socket-client";
import type { AvailableEditors, LocalRepoNotFound } from "@cmux/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import React, { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { cachedGetUser } from "../../lib/cachedGetUser";
import { stackClientApp } from "../../lib/stack";
import { authJsonQueryOptions } from "../convex/authJsonQueryOptions";
import { setGlobalSocket, socketBoot } from "./socket-boot";
import { ElectronSocketContext } from "./socket-context";
import type { SocketContextType } from "./types";

export const ElectronSocketProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const authJsonQuery = useQuery(authJsonQueryOptions());
  const authToken = authJsonQuery.data?.accessToken;
  const location = useLocation();
  const [socket, setSocket] = React.useState<
    SocketContextType["socket"] | null
  >(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [availableEditors, setAvailableEditors] =
    React.useState<SocketContextType["availableEditors"]>(null);
  const socketRef = useRef<CmuxIpcSocketClient | null>(null);
  const lastAuthTokenRef = useRef<string | null>(null);
  const teamSlugOrId = React.useMemo(() => {
    const pathname = location.pathname || "";
    const seg = pathname.split("/").filter(Boolean)[0];
    if (!seg || seg === "team-picker") return undefined;
    return seg;
  }, [location.pathname]);

  // Effect to update auth token on existing socket without reconnecting
  useEffect(() => {
    if (!authToken || !socketRef.current) return;
    if (lastAuthTokenRef.current === authToken) return;

    const prevToken = lastAuthTokenRef.current;
    lastAuthTokenRef.current = authToken;

    // If we had a previous token, this is a refresh - update via authenticate event
    if (prevToken && socketRef.current.connected) {
      console.log("[ElectronSocket] Auth token refreshed, updating server...");
      (async () => {
        const user = await cachedGetUser(stackClientApp);
        const authJson = user ? await user.getAuthJson() : undefined;
        socketRef.current?.emit(
          "authenticate",
          {
            authToken,
            authJson: authJson ? JSON.stringify(authJson) : undefined,
          },
          (response: { ok: boolean; error?: string }) => {
            if (response?.ok) {
              console.log("[ElectronSocket] Auth token updated successfully");
            } else {
              console.error(
                "[ElectronSocket] Failed to update auth token:",
                response?.error
              );
            }
          }
        );
      })();
    }
  }, [authToken]);

  // Track whether we have ever connected, to know if we need to establish initial connection
  const hasConnectedRef = useRef(false);

  // Effect to establish initial socket connection (only on teamSlugOrId change or initial mount)
  useEffect(() => {
    if (!authToken) {
      console.warn("[ElectronSocket] No auth token yet; delaying connect");
      return;
    }

    // If socket already exists and team hasn't changed, skip reconnection
    // (token refresh is handled by the separate effect above)
    if (socketRef.current && hasConnectedRef.current) {
      return;
    }

    let disposed = false;

    (async () => {
      const user = await cachedGetUser(stackClientApp);
      const authJson = user ? await user.getAuthJson() : undefined;

      const query: Record<string, string> = { auth: authToken };
      if (teamSlugOrId) {
        query.team = teamSlugOrId;
      }
      if (authJson) {
        query.auth_json = JSON.stringify(authJson);
      }

      if (disposed) return;

      console.log("[ElectronSocket] Connecting via IPC (cmux)...");
      const createdSocket = new CmuxIpcSocketClient(query);
      socketRef.current = createdSocket;
      lastAuthTokenRef.current = authToken;
      hasConnectedRef.current = true;

      createdSocket.on("connect", () => {
        if (disposed) return;
        setIsConnected(true);
      });

      createdSocket.on("disconnect", () => {
        if (disposed) return;
        console.log("[ElectronSocket] Disconnected from IPC");
        setIsConnected(false);
      });

      createdSocket.on("connect_error", (error: unknown) => {
        console.error("[ElectronSocket] Connection error:", error);
      });

      createdSocket.on("available-editors", (editors: AvailableEditors) => {
        if (disposed) return;
        setAvailableEditors(editors);
      });

      createdSocket.on("local-repo-not-found", (data: LocalRepoNotFound) => {
        if (disposed) return;
        toast.error("Local Repository Not Found", {
          description: data.message,
          duration: 10000,
          action: {
            label: "Settings",
            onClick: () => {
              window.location.href = `/${teamSlugOrId}/settings?section=worktrees`;
            },
          },
        });
      });

      // Connect the socket
      createdSocket.connect();

      if (!disposed) {
        setSocket(createdSocket);
        setGlobalSocket(createdSocket);
        // Signal that the provider has created the socket instance
        socketBoot.resolve();
      }
    })();

    return () => {
      disposed = true;
      if (socketRef.current) {
        console.log("[ElectronSocket] Cleaning up IPC socket");
        socketRef.current.disconnect();
        socketRef.current = null;
        lastAuthTokenRef.current = null;
        hasConnectedRef.current = false;
        setSocket(null);
        setIsConnected(false);
      }
      // Reset boot handle so future mounts can suspend appropriately
      setGlobalSocket(null);
      socketBoot.reset();
    };
  }, [authToken, teamSlugOrId]);

  const contextValue = useMemo<SocketContextType>(
    () => ({
      socket,
      isConnected,
      availableEditors,
    }),
    [socket, isConnected, availableEditors]
  );

  return (
    <ElectronSocketContext.Provider value={contextValue}>
      {children}
    </ElectronSocketContext.Provider>
  );
};
