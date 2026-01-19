declare module "@tanstack/history" {
  interface HistoryState {
    initialPrompt?: string | null;
    clientMessageId?: string | null;
    conversationId?: string | null;
    optimisticText?: string | null;
    optimisticClientMessageId?: string | null;
    optimisticCreatedAt?: number;
  }
}
