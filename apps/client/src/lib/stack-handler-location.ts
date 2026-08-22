function searchParamsFromRouterSearch(
  routerSearch: string
): URLSearchParams | null {
  const raw = routerSearch.startsWith("?")
    ? routerSearch.slice(1)
    : routerSearch;
  if (!raw) {
    return null;
  }
  return new URLSearchParams(raw);
}

/**
 * Hash history keeps OAuth params on the hash (`#/handler/oauth-callback?code=`).
 * Stack's callOAuthCallback only inspects window.location.search, so copy
 * missing code/state onto the real search string before the callback runs.
 */
export function liftOAuthQueryToWindowSearch(routerSearch: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const incoming = searchParamsFromRouterSearch(routerSearch);
  if (!incoming?.has("code") || !incoming.has("state")) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.has("code") && url.searchParams.has("state")) {
    return;
  }

  for (const [key, value] of incoming.entries()) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }

  const hashQueryIndex = url.hash.indexOf("?");
  if (hashQueryIndex >= 0) {
    url.hash = url.hash.slice(0, hashQueryIndex);
  }

  window.history.replaceState({}, "", url.toString());
}
