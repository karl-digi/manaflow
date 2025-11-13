import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  authToken?: string;
  authHeaderJson?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithAuth<T>(
  authToken: string | null | undefined,
  authHeaderJson: string | null | undefined,
  fn: () => T
): T {
  return storage.run(
    {
      authToken: authToken ?? undefined,
      authHeaderJson: authHeaderJson ?? undefined,
    },
    fn
  );
}

export function runWithAuthToken<T>(
  authToken: string | null | undefined,
  fn: () => T
): T {
  return runWithAuth(authToken, undefined, fn);
}

export function getAuthToken(): string | undefined {
  return storage.getStore()?.authToken;
}

export function getAuthHeaderJson(): string | undefined {
  return storage.getStore()?.authHeaderJson;
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
