import { findUnescapedQuoteIndex } from "./find-unescaped-quote-index";

export type ParsedEnv = { name: string; value: string };

export function parseEnvBlock(text: string): ParsedEnv[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const results: ParsedEnv[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    let line = raw.trim();
    i++;

    if (line.length === 0) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;

    line = line.replace(/^export\s+/, "").replace(/^set\s+/, "");

    let key = "";
    let rest = "";
    const eqIdx = line.indexOf("=");
    const colonIdx = line.indexOf(":");
    if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
      key = line.slice(0, eqIdx).trim();
      rest = line.slice(eqIdx + 1).trim();
    } else if (colonIdx !== -1) {
      key = line.slice(0, colonIdx).trim();
      rest = line.slice(colonIdx + 1).trim();
    } else {
      const match = line.match(/^(\S+)\s+(.*)$/);
      if (match) {
        key = match[1] ?? "";
        rest = (match[2] ?? "").trim();
      } else {
        key = line;
        rest = "";
      }
    }

    if (!key || /\s/.test(key)) continue;

    if (rest.startsWith('"') || rest.startsWith("'") || rest.startsWith("`")) {
      const quote = rest[0] as '"' | "'" | "`";
      let acc = rest.slice(1);
      let closedIdx = findUnescapedQuoteIndex(acc, quote);

      while (closedIdx === -1 && i < lines.length) {
        acc += "\n" + (lines[i] ?? "");
        i++;
        closedIdx = findUnescapedQuoteIndex(acc, quote);
      }

      let value = acc;
      if (closedIdx !== -1) {
        value = acc.slice(0, closedIdx);
      }

      results.push({ name: key, value });
      continue;
    }

    const value = rest.replace(/\s+#.*$/, "").trim();
    results.push({ name: key, value });
  }

  return results;
}
