import type {
  ClientToServerEvents,
  SocketAuthPayload,
} from "@cmux/shared";
import type { MainServerSocket } from "@cmux/shared/socket";
import { cachedGetUser } from "./cachedGetUser";
import { stackClientApp } from "./stack";

type ClientEventParams<E extends keyof ClientToServerEvents> =
  Parameters<ClientToServerEvents[E]>;
type EventPayload<E extends keyof ClientToServerEvents> =
  ClientEventParams<E>[0];
type EventRest<E extends keyof ClientToServerEvents> =
  ClientEventParams<E] extends [any, ...infer Rest] ? Rest : never;
type AuthlessPayload<P> = P extends SocketAuthPayload
  ? Omit<P, "auth">
  : P;

export async function withSocketAuthPayload<T extends Record<string, unknown>>(
  payload: T
): Promise<T & SocketAuthPayload> {
  const user = await cachedGetUser(stackClientApp);
  if (!user) {
    throw new Error("No authenticated user");
  }
  const authHeaders = await user.getAuthHeaders();
  return {
    ...payload,
    auth: authHeaders,
  };
}

export async function emitWithAuth<E extends keyof ClientToServerEvents>(
  socket: MainServerSocket | null,
  event: E,
  data: AuthlessPayload<EventPayload<E>>,
  ...rest: EventRest<E>
): Promise<boolean> {
  if (!socket) {
    console.warn(`[SocketAuth] Cannot emit "${event}" without socket connection`);
    return false;
  }

  try {
    const payload = await withSocketAuthPayload(
      (data as Record<string, unknown>) ?? ({} as Record<string, unknown>)
    );
    socket.emit(event, payload as EventPayload<E>, ...(rest as EventRest<E>));
    return true;
  } catch (error) {
    console.error(`[SocketAuth] Failed to emit "${event}"`, error);
    return false;
  }
}
