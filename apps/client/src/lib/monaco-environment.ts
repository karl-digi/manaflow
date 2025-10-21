import { loader } from "@monaco-editor/react";

import * as monaco from "monaco-editor";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/editor/browser/services/hoverService/hoverService";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { diffColorPalette } from "./diff-colors";

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

function defineThemes(instance: typeof monaco) {
  const lightPalette = diffColorPalette.light;
  const darkPalette = diffColorPalette.dark;

  instance.editor.defineTheme("cmux-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "diffEditor.insertedLineBackground": lightPalette.addition.lineBackground,
      "diffEditor.removedLineBackground": lightPalette.deletion.lineBackground,
      "diffEditor.insertedTextBackground": lightPalette.addition.textBackground,
      "diffEditor.removedTextBackground": lightPalette.deletion.textBackground,
      "diffEditor.insertedTextBorder": "#00000000",
      "diffEditor.removedTextBorder": "#00000000",
      "diffEditorGutter.insertedLineBackground":
        lightPalette.addition.gutterBackground,
      "diffEditorGutter.removedLineBackground":
        lightPalette.deletion.gutterBackground,
      "diffEditorOverview.insertedForeground":
        lightPalette.addition.gutterBackground,
      "diffEditorOverview.removedForeground":
        lightPalette.deletion.gutterBackground,
      "editorGutter.addedBackground": lightPalette.addition.gutterBackground,
      "editorGutter.deletedBackground": lightPalette.deletion.gutterBackground,
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
      "diffEditor.insertedLineBackground": darkPalette.addition.lineBackground,
      "diffEditor.removedLineBackground": darkPalette.deletion.lineBackground,
      "diffEditor.insertedTextBackground": darkPalette.addition.textBackground,
      "diffEditor.removedTextBackground": darkPalette.deletion.textBackground,
      "diffEditor.insertedTextBorder": "#00000000",
      "diffEditor.removedTextBorder": "#00000000",
      "diffEditorGutter.insertedLineBackground":
        darkPalette.addition.gutterBackground,
      "diffEditorGutter.removedLineBackground":
        darkPalette.deletion.gutterBackground,
      "diffEditorOverview.insertedForeground":
        darkPalette.addition.gutterBackground,
      "diffEditorOverview.removedForeground":
        darkPalette.deletion.gutterBackground,
      "editorGutter.addedBackground": darkPalette.addition.gutterBackground,
      "editorGutter.deletedBackground": darkPalette.deletion.gutterBackground,
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
