import { Diff, Hunk } from "@/components/diff";

import {
  CollapsibleCard,
  CollapsibleCardHeader,
  CollapsibleCardTitle,
  CollapsibleCardContent,
} from "@/components/ui/collapsible-card";

import { parseDiff } from "@/components/ui/diff/utils/parse";
import type { ParseOptions } from "@/components/ui/diff/utils/parse";

export function DiffViewer({
  patch,
  options = {},
}: {
  patch: string;
  options?: Partial<ParseOptions>;
}) {
  const [file] = parseDiff(patch, options);

  return (
    <CollapsibleCard
      data-section-id="diff-viewer"
      id="diff-viewer"
      className="my-4 text-[0.8rem] w-full"
      title="File Changes"
      defaultOpen
    >
      <CollapsibleCardHeader>
        <CollapsibleCardTitle title={file.newPath}>
          {file.newPath}
        </CollapsibleCardTitle>
      </CollapsibleCardHeader>
      <CollapsibleCardContent>
        <Diff fileName="file-changes.tsx" hunks={file.hunks} type={file.type}>
          {file.hunks.map((hunk) => (
            <Hunk key={hunk.content} hunk={hunk} />
          ))}
        </Diff>
      </CollapsibleCardContent>
    </CollapsibleCard>
  );
}
