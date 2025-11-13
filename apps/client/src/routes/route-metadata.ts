export type RouteTitleFormatterContext = {
  params: Record<string, unknown>;
  search: unknown;
  pathname: string;
};

export type RouteTitleStaticData = {
  /**
   * Default fallback title for a route.
   */
  title: string;
  /**
   * Optional formatter that can derive a context-aware title.
   */
  formatTitle?: (ctx: RouteTitleFormatterContext) => string;
};

export function formatRouteTitle(...parts: Array<string | undefined>) {
  const cleaned = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  return cleaned.length > 0 ? cleaned.join(" · ") : undefined;
}
