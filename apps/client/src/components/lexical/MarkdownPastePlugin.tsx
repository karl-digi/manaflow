import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from "lexical";
import { useEffect } from "react";

/**
 * Plugin to handle pasting markdown content.
 *
 * When users paste text that looks like markdown (containing code blocks,
 * headers, lists, etc.), this plugin converts the markdown into proper
 * Lexical nodes instead of inserting it as plain text.
 *
 * This ensures that when the content is exported back to markdown via
 * $convertToMarkdownString, code blocks and other formatting are preserved
 * correctly without character escaping.
 */
export function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Check if pasted text looks like it contains markdown
    const looksLikeMarkdown = (text: string): boolean => {
      // Check for code blocks (most important for this fix)
      if (/```[\s\S]*```/.test(text)) {
        return true;
      }
      // Check for headers
      if (/^#{1,6}\s+.+$/m.test(text)) {
        return true;
      }
      // Check for unordered lists
      if (/^[\s]*[-*+]\s+.+$/m.test(text)) {
        return true;
      }
      // Check for ordered lists
      if (/^[\s]*\d+\.\s+.+$/m.test(text)) {
        return true;
      }
      // Check for blockquotes
      if (/^>\s+.+$/m.test(text)) {
        return true;
      }
      return false;
    };

    const unregister = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }

        // Only intercept if there's text data (not files/images)
        const text = clipboardData.getData("text/plain");
        if (!text) {
          return false;
        }

        // Check if pasting files (let ImagePlugin handle this)
        if (clipboardData.files.length > 0) {
          return false;
        }

        // Check if the text looks like markdown
        if (!looksLikeMarkdown(text)) {
          return false;
        }

        // Prevent default paste behavior
        event.preventDefault();

        // Convert markdown to Lexical nodes
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            // Remove selected content first
            selection.removeText();
          }

          // Parse markdown and insert nodes
          $convertFromMarkdownString(text, TRANSFORMERS);
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    return unregister;
  }, [editor]);

  return null;
}
