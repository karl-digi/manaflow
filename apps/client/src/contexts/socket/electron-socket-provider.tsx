import { CmuxIpcSocketClient } from "@/lib/cmux-ipc-socket-client";
import { type MainServerSocket } from "@cmux/shared/socket";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import React, { useEffect, useMemo } from "react";
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
  const authJsonData = authJsonQuery.data;
  const authToken =
    authJsonData?.refreshedAccessToken ??
    authJsonData?.accessToken ??
    undefined;
  const location = useLocation();
  const [socket, setSocket] = React.useState<
    SocketContextType["socket"] | null
  >(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [availableEditors, setAvailableEditors] =
    React.useState<SocketContextType["availableEditors"]>(null);
  const teamSlugOrId = React.useMemo(() => {
    const pathname = location.pathname || "";
    const seg = pathname.split("/").filter(Boolean)[0];
    if (!seg || seg === "team-picker") return undefined;
    return seg;
  }, [location.pathname]);

  useEffect(() => {
    if (!authToken) {
      console.warn("[ElectronSocket] No auth token yet; delaying connect");
      return;
    }

    let disposed = false;
    let createdSocket: CmuxIpcSocketClient | null = null;

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
      createdSocket = new CmuxIpcSocketClient(query);

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

      createdSocket.on("available-editors", (editors: unknown) => {
        if (disposed) return;
        setAvailableEditors(editors as SocketContextType["availableEditors"]);
      });

      try {
        await createdSocket.connect();
      } catch (error) {
        console.error("[ElectronSocket] Failed to connect via IPC:", error);
        return;
      }

      if (!disposed) {
        // Cast to Socket type to satisfy type requirement
        setSocket(createdSocket as unknown as MainServerSocket);
        setGlobalSocket(createdSocket as unknown as MainServerSocket);
        // Signal that the provider has created the socket instance
        socketBoot.resolve();
      } else {
        createdSocket.disconnect();
      }
    })();

    return () => {
      disposed = true;
      if (createdSocket) {
        console.log("[ElectronSocket] Cleaning up IPC socket");
        createdSocket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      // Reset boot handle so future mounts can suspend appropriately
      setGlobalSocket(null);
      socketBoot.reset();
    };
  }, [authToken, teamSlugOrId]);

  useEffect(() => {
    if (!socket || !authToken) {
      return;
    }
    const authJsonString =
      authJsonData !== null && authJsonData !== undefined
        ? JSON.stringify(authJsonData)
        : undefined;
    socket.emit("update-auth", {
      authToken,
      authJson: authJsonString,
    });
  }, [socket, authToken, authJsonData]);

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
