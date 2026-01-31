/**
 * Rivet Actor Types
 *
 * This file re-exports types from the server registry for client use.
 * The registry itself is in rivet-server/registry.ts and is NOT bundled with the client.
 */

// Import ONLY the type from the server registry
// This gives us e2e type safety without bundling the implementation
import type { registry } from "../../rivet-server/registry";

// Re-export the registry type for client hooks
export type { registry };

// Export concrete types for use in components
export type {
  Message,
  ChatInfo,
  ImageAttachment,
  SendMessageInput,
  ToolCall,
} from "../../rivet-server/registry";
