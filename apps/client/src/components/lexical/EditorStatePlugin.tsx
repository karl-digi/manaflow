import {
  $convertToMarkdownString,
  TRANSFORMERS,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $createParagraphNode,
  $getSelection,
  $createTextNode,
  ParagraphNode,
  type LexicalNode,
  ElementNode,
} from "lexical";
import { useEffect } from "react";
import { $isImageNode, ImageNode } from "./ImageNode";

// Custom transformer for ImageNode to export as plain filename
// Using plain filename instead of markdown syntax to avoid shell pattern issues
// when CLI tools process the task description
const IMAGE_TRANSFORMER: Transformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) {
      return null;
    }
    const fileName = node.getFileName();
    const altText = node.getAltText();
    // Use fileName if available, otherwise use altText as reference
    const imageRef = fileName || `image: ${altText}`;
    // Export as plain filename with surrounding spaces to ensure proper separation
    // from adjacent text. The backend will replace this with the sanitized path.
    return ` ${imageRef} `;
  },
  regExp: /!\[([^\]]*)\]\(([^)]+)\)/,
  replace: () => {
    // Import is not needed since we handle images via paste/drag-drop
    // Return void (do nothing) - images are handled separately
  },
  type: "text-match",
};

// Combine default transformers with our custom image transformer
const EXTENDED_TRANSFORMERS: Transformer[] = [IMAGE_TRANSFORMER, ...TRANSFORMERS];

interface ExtractedContent {
  text: string;
  images: Array<{
    src: string;
    fileName?: string;
    altText: string;
  }>;
}

interface EditorApi {
  getContent: () => {
    text: string;
    images: Array<{
      src: string;
      fileName?: string;
      altText: string;
    }>;
  };
  clear: () => void;
  focus: () => void;
  insertText: (text: string) => void;
}

export function EditorStatePlugin({ onEditorReady }: { onEditorReady?: (api: EditorApi) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (onEditorReady) {
      const api = {
        getContent: (): ExtractedContent => {
          const content: ExtractedContent = {
            text: "",
            images: []
          };

          editor.getEditorState().read(() => {
            const root = $getRoot();

            // First, collect all images from the editor
            const collectImages = (node: LexicalNode): void => {
              if ($isImageNode(node)) {
                const fileName = node.getFileName();
                const altText = node.getAltText();

                content.images.push({
                  src: node.getSrc(),
                  fileName: fileName,
                  altText: altText
                });
              } else if (node instanceof ElementNode) {
                const children = node.getChildren();
                children.forEach(collectImages);
              }
            };

            const children = root.getChildren();
            children.forEach(collectImages);

            // Use $convertToMarkdownString to preserve formatting (newlines, headers, etc.)
            // This properly handles paragraphs, headings, lists, code blocks, etc.
            // Use EXTENDED_TRANSFORMERS to include our custom ImageNode transformer
            content.text = $convertToMarkdownString(EXTENDED_TRANSFORMERS).trim();
          });

          return content;
        },
        clear: () => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();
            const paragraph = $createParagraphNode();
            root.append(paragraph);
            paragraph.select();
          });
        },
        focus: () => {
          editor.focus();
        },
        insertText: (text: string) => {
          editor.update(() => {
            const selection = $getSelection();
            if (selection) {
              selection.insertText(text);
            } else {
              // If no selection, append to the last paragraph
              const root = $getRoot();
              const children = root.getChildren();
              let lastParagraph: ParagraphNode | null = null;
              
              // Find the last paragraph node
              for (let i = children.length - 1; i >= 0; i--) {
                if (children[i].getType() === 'paragraph') {
                  lastParagraph = children[i] as ParagraphNode;
                  break;
                }
              }
              
              // If no paragraph exists, create one
              if (!lastParagraph) {
                lastParagraph = $createParagraphNode();
                root.append(lastParagraph);
              }
              
              // Append the text node to the paragraph
              const textNode = $createTextNode(text);
              lastParagraph.append(textNode);
              textNode.select();
            }
          });
        }
      };

      onEditorReady(api);
    }
  }, [editor, onEditorReady]);

  return null;
}
