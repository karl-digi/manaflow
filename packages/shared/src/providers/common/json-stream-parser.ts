/**
 * Creates a parser for JSON object streams (concatenated JSON objects without delimiters).
 * Handles objects that may span multiple chunks and nested objects.
 *
 * Used by Gemini and Qwen telemetry parsers where the telemetry file contains
 * multiple JSON objects written sequentially.
 *
 * @param onObject - Callback invoked for each successfully parsed JSON object
 * @returns A function that accepts string chunks to parse
 */
export function createJsonStreamParser(
  onObject: (obj: unknown) => void
): (chunk: string) => void {
  let collecting = false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let buf = "";

  return (chunk: string) => {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      // Handle string content (respect escape sequences)
      if (inString) {
        buf += ch;
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      // Start of string
      if (ch === '"') {
        inString = true;
        if (collecting) buf += ch;
        continue;
      }

      // Start of object
      if (ch === "{") {
        if (!collecting) {
          collecting = true;
          depth = 1;
          buf = "{";
        } else {
          depth++;
          buf += ch;
        }
        continue;
      }

      // End of object
      if (ch === "}") {
        if (collecting) {
          depth--;
          buf += ch;
          if (depth === 0) {
            try {
              const obj = JSON.parse(buf);
              onObject(obj);
            } catch {
              // Ignore parse errors and try to resume on the next object
            }
            collecting = false;
            buf = "";
          }
        }
        continue;
      }

      // Other characters
      if (collecting) {
        buf += ch;
      }
    }
  };
}
