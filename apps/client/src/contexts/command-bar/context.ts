import { createContext } from "react";

export type CommandBarContextValue = {
  isOpen: boolean;
  openCommandBar: () => void;
  closeCommandBar: () => void;
  setIsOpen: (open: boolean) => void;
};

export const CommandBarContext = createContext<CommandBarContextValue | null>(null);
