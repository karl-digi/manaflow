import { useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Image as ImageIcon } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";

export default function ImageComponent({
  src,
  altText,
  fileName,
  nodeKey,
}: {
  src: string;
  altText: string;
  fileName?: string;
  nodeKey?: NodeKey;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editor] = useLexicalComposerContext();

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!nodeKey) return;
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node) {
          node.remove();
        }
      });
    },
    [editor, nodeKey]
  );

  // Get display name - truncate if too long
  const displayName = fileName || "Image";
  const truncatedName =
    displayName.length > 20
      ? displayName.slice(0, 17) + "..."
      : displayName;

  return (
    <>
      {/* Pillbox/chip preview */}
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 my-0.5 mx-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors group"
        onClick={() => setIsOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        {/* Small thumbnail */}
        <img
          src={src}
          alt={altText}
          className="w-5 h-5 object-cover rounded-sm flex-shrink-0"
        />
        {/* Filename */}
        <span className="text-xs text-neutral-700 dark:text-neutral-300 max-w-[120px] truncate">
          {truncatedName}
        </span>
        {/* Remove button */}
        {nodeKey && (
          <button
            type="button"
            onClick={handleRemove}
            className="ml-0.5 p-0.5 rounded hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Remove image"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </span>

      {/* Expanded lightbox modal */}
      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-neutral-950/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(1200px,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-950">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                <ImageIcon className="w-4 h-4 text-neutral-500" />
                {displayName}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Image container */}
            <div className="flex-1 flex items-center justify-center overflow-hidden rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 min-h-[200px] max-h-[70vh]">
              <img
                src={src}
                alt={altText}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
