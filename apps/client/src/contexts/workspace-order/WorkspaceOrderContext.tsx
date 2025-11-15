import { useLocalStorage } from "@mantine/hooks";
import {
  createContext,
  useContext,
  useMemo,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

interface WorkspaceOrderContextValue {
  order: string[];
  setOrder: Dispatch<SetStateAction<string[]>>;
}

const WorkspaceOrderContext = createContext<WorkspaceOrderContextValue | null>(
  null
);

interface WorkspaceOrderProviderProps {
  children: ReactNode;
  teamSlugOrId: string;
}

export function WorkspaceOrderProvider({
  children,
  teamSlugOrId,
}: WorkspaceOrderProviderProps) {
  const [order, setOrder] = useLocalStorage<string[]>({
    key: `workspace-order-${teamSlugOrId}`,
    defaultValue: [],
    getInitialValueInEffect: true,
  });

  const value = useMemo(
    () => ({
      order,
      setOrder,
    }),
    [order, setOrder]
  );

  return (
    <WorkspaceOrderContext.Provider value={value}>
      {children}
    </WorkspaceOrderContext.Provider>
  );
}

export function useWorkspaceOrderContext() {
  const context = useContext(WorkspaceOrderContext);
  if (!context) {
    throw new Error(
      "useWorkspaceOrderContext must be used within a WorkspaceOrderProvider"
    );
  }
  return context;
}
