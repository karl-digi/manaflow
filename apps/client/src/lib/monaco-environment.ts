import { loader } from "@monaco-editor/react";

import * as monaco from "monaco-editor";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/editor/browser/services/hoverService/hoverService";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { DIFF_COLOR_PALETTE } from "./diff-colors";
import type { DiffColorPalette } from "./diff-colors";

const monacoEnvironment = {
  getWorker(_: string, label: string): Worker {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

Object.assign(self, { MonacoEnvironment: monacoEnvironment });

loader.config({
  monaco,
});

function buildDiffEditorColors(
  palette: DiffColorPalette,
): Record<string, string> {
  const { addition, deletion } = palette;
  return {
    "diffEditor.insertedLineBackground": addition.lineBackground,
    "diffEditor.removedLineBackground": deletion.lineBackground,
    "diffEditor.insertedTextBackground": addition.textBackground,
    "diffEditor.removedTextBackground": deletion.textBackground,
    "diffEditorGutter.insertedLineBackground": addition.gutterBackground,
    "diffEditorGutter.removedLineBackground": deletion.gutterBackground,
  };
}

function defineThemes(instance: typeof monaco) {
  const lightDiffColors = buildDiffEditorColors(DIFF_COLOR_PALETTE.light);
  const darkDiffColors = buildDiffEditorColors(DIFF_COLOR_PALETTE.dark);

  instance.editor.defineTheme("cmux-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      ...lightDiffColors,
      "diffEditor.unchangedRegionBackground": "#f4f4f5",
      "diffEditor.unchangedRegionForeground": "#52525b",
      "diffEditor.unchangedRegionShadow": "#0f172a33",
    },
  });

  instance.editor.defineTheme("cmux-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      ...darkDiffColors,
      "diffEditor.unchangedRegionBackground": "#27272a",
      "diffEditor.unchangedRegionForeground": "#e5e5e5",
      "diffEditor.unchangedRegionShadow": "#00000080",
    },
  });
}

export const loaderInitPromise = new Promise<typeof monaco>((resolve) => {
  loader.init().then((instance) => {
    defineThemes(instance);
    resolve(instance);
  });
});
