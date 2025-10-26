// VS Code Extension Socket.IO Events

export interface VSCodeServerToClientEvents {
  // Health check
  "vscode:pong": () => void;

  // Status updates
  "vscode:status": (data: {
    ready: boolean;
    message: string;
    workspaceFolders?: string[];
  }) => void;

  // Terminal events
  "vscode:terminal-created": (data: {
    terminalId: string;
    name: string;
    cwd: string;
  }) => void;

  "vscode:terminal-output": (data: {
    terminalId: string;
    data: string;
  }) => void;

  "vscode:terminal-closed": (data: { terminalId: string }) => void;

  // Command execution results
  "vscode:command-result": (data: {
    commandId: string;
    success: boolean;
    error?: string;
  }) => void;
}

export interface VSCodeClientToServerEvents {
  // Health check
  "vscode:ping": (callback: (data: { timestamp: number }) => void) => void;

  // Create terminal
  "vscode:create-terminal": (
    data: {
      name?: string;
      command?: string;
    },
    callback: (response: { success: boolean; error?: string }) => void
  ) => void;

  // Get status
  "vscode:get-status": (
    callback: (data: {
      ready: boolean;
      workspaceFolders?: string[];
      extensions?: string[];
    }) => void
  ) => void;

  // Set theme
  "vscode:set-theme": (
    data: {
      theme: "dark" | "light";
    },
    callback?: (response: { success: boolean; error?: string }) => void
  ) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface VSCodeInterServerEvents {}

export interface VSCodeSocketData {
  clientId?: string;
}
