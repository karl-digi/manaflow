import { createContext, useContext } from "react";

export interface CommandBarContextType {
  openCommandBar: () => void;
  registerOpenHandler: (handler: () => void) => void;
}

export const CommandBarContext = createContext<CommandBarContextType | undefined>(undefined);

export function useCommandBar() {
  const context = useContext(CommandBarContext);
  if (!context) {
    throw new Error("useCommandBar must be used within a CommandBarProvider");
  }
  return context;
}
