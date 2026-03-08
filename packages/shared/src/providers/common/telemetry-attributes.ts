/**
 * Utilities for extracting attributes from telemetry events.
 * Used by Gemini and Qwen completion detectors to parse OpenTelemetry-style events.
 */

export type AttributeMap = Record<string, unknown>;

/**
 * Extracts attributes from a telemetry event object.
 * Checks multiple locations where attributes may be stored:
 * - event.attributes (direct)
 * - event.resource.attributes
 * - event.body.attributes
 *
 * @param event - The telemetry event object
 * @returns The attributes map or null if not found
 */
export function extractAttributes(event: unknown): AttributeMap | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as Record<string, unknown>;

  // Check direct attributes
  const direct = record.attributes;
  if (direct && typeof direct === "object") {
    return direct as AttributeMap;
  }

  // Check resource.attributes
  const resource = record.resource;
  if (
    resource &&
    typeof resource === "object" &&
    "attributes" in resource &&
    resource.attributes &&
    typeof resource.attributes === "object"
  ) {
    return resource.attributes as AttributeMap;
  }

  // Check body.attributes
  const body = record.body;
  if (
    body &&
    typeof body === "object" &&
    "attributes" in body &&
    body.attributes &&
    typeof body.attributes === "object"
  ) {
    return body.attributes as AttributeMap;
  }

  return null;
}

/**
 * Retrieves the first matching string attribute from an attribute map.
 * Useful when attribute names may vary between telemetry versions.
 *
 * @param attrs - The attributes map to search
 * @param keys - Priority-ordered list of possible attribute keys
 * @returns The first found string value, or undefined if none found
 */
export function chooseAttr(
  attrs: AttributeMap,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}
