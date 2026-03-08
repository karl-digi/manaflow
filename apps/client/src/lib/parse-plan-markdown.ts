export interface ParsedPlanItem {
  title: string;
  body: string;
}

function normalizeHeadingTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim();
  if (/^plan:\s*/i.test(trimmed)) {
    const stripped = trimmed.replace(/^plan:\s*/i, "").trim();
    if (stripped.length > 0) {
      return stripped;
    }
  }
  return trimmed;
}

function extractHeading(line: string, level: 1 | 2): string | null {
  const trimmedStart = line.trimStart();
  const hashes = level === 1 ? "#" : "##";
  if (!trimmedStart.startsWith(hashes)) {
    return null;
  }
  const nextChar = trimmedStart[hashes.length];
  if (nextChar === "#" || (nextChar !== " " && nextChar !== "\t")) {
    return null;
  }
  const title = trimmedStart.slice(hashes.length).trim();
  return title.length > 0 ? title : null;
}

export function parsePlanMarkdown(markdown: string): ParsedPlanItem[] {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (normalized.trim().length === 0) {
    return [];
  }

  const lines = normalized.split("\n");
  const parsedItems: ParsedPlanItem[] = [];
  let currentTitle: string | null = null;
  let currentBodyLines: string[] = [];

  for (const line of lines) {
    const h2Title = extractHeading(line, 2);
    if (h2Title !== null) {
      if (currentTitle !== null) {
        parsedItems.push({
          title: currentTitle,
          body: currentBodyLines.join("\n").trim(),
        });
      }
      currentTitle = h2Title;
      currentBodyLines = [];
      continue;
    }

    if (currentTitle !== null) {
      currentBodyLines.push(line);
    }
  }

  if (currentTitle !== null) {
    parsedItems.push({
      title: currentTitle,
      body: currentBodyLines.join("\n").trim(),
    });
  }

  if (parsedItems.length > 0) {
    return parsedItems;
  }

  const h1Line = lines.find((line) => extractHeading(line, 1) !== null);
  const h1Title = h1Line ? extractHeading(h1Line, 1) : null;

  return [
    {
      title: normalizeHeadingTitle(h1Title ?? "Imported Plan"),
      body: normalized.trim(),
    },
  ];
}
