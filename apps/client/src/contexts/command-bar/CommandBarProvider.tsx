import { useCallback, useRef, type ReactNode } from "react";
import { CommandBarContext } from "./CommandBarContext";

export function CommandBarProvider({ children }: { children: ReactNode }) {
  const openHandlerRef = useRef<(() => void) | null>(null);

  const registerOpenHandler = useCallback((handler: () => void) => {
    openHandlerRef.current = handler;
  }, []);

  const openCommandBar = useCallback(() => {
    openHandlerRef.current?.();
  }, []);

  return (
    <CommandBarContext.Provider value={{ openCommandBar, registerOpenHandler }}>
      {children}
    </CommandBarContext.Provider>
  );
}
