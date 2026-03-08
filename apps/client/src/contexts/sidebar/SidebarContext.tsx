import { createContext, useContext } from "react";

interface SidebarContextValue {
  isHidden: boolean;
  setIsHidden: (hidden: boolean) => void;
  toggle: () => void;
}

export const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

export function useSidebarOptional() {
  return useContext(SidebarContext);
}
