import { RESERVED_CMUX_PORTS } from "./reserved-cmux-ports";

export const RESERVED_EXPOSED_PORTS = RESERVED_CMUX_PORTS;
const RESERVED_PORT_SET = new Set<number>(RESERVED_EXPOSED_PORTS);

export interface ExposedPortValidationResult {
  sanitized: number[];
  invalid: number[];
  reserved: number[];
}

export function validateExposedPorts(
  ports: Iterable<number>
): ExposedPortValidationResult {
  const sanitizedSet = new Set<number>();
  const invalidSet = new Set<number>();
  const reservedSet = new Set<number>();

  for (const value of ports) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    const normalized = Math.trunc(numeric);
    if (normalized <= 0) {
      invalidSet.add(normalized);
      continue;
    }
    if (RESERVED_PORT_SET.has(normalized)) {
      reservedSet.add(normalized);
      continue;
    }
    sanitizedSet.add(normalized);
  }

  const sanitize = (set: Set<number>): number[] =>
    Array.from(set.values()).sort((a, b) => a - b);

  return {
    sanitized: sanitize(sanitizedSet),
    invalid: sanitize(invalidSet),
    reserved: sanitize(reservedSet),
  };
}
