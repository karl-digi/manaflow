import { useCallback, useState, type ReactNode } from "react";
import { CommandBarContext } from "./context";

export function CommandBarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openCommandBar = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeCommandBar = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <CommandBarContext.Provider
      value={{ isOpen, openCommandBar, closeCommandBar, setIsOpen }}
    >
      {children}
    </CommandBarContext.Provider>
  );
}
