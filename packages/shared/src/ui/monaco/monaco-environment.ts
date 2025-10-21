import { loader } from "@monaco-editor/react";

import * as monaco from "monaco-editor";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/editor/browser/services/hoverService/hoverService";

const editorWorkerUrl = new URL(
  "monaco-editor/esm/vs/editor/editor.worker.js",
  import.meta.url,
);
const cssWorkerUrl = new URL(
  "monaco-editor/esm/vs/language/css/css.worker.js",
  import.meta.url,
);
const htmlWorkerUrl = new URL(
  "monaco-editor/esm/vs/language/html/html.worker.js",
  import.meta.url,
);
const jsonWorkerUrl = new URL(
  "monaco-editor/esm/vs/language/json/json.worker.js",
  import.meta.url,
);
const tsWorkerUrl = new URL(
  "monaco-editor/esm/vs/language/typescript/ts.worker.js",
  import.meta.url,
);

function createWorker(url: URL): Worker {
  return new Worker(url, { type: "module" });
}

const monacoEnvironment = {
  getWorker(_: string, label: string): Worker {
    if (label === "json") {
      return createWorker(jsonWorkerUrl);
    }
    if (label === "css" || label === "scss" || label === "less") {
      return createWorker(cssWorkerUrl);
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return createWorker(htmlWorkerUrl);
    }
    if (label === "typescript" || label === "javascript") {
      return createWorker(tsWorkerUrl);
    }
    return createWorker(editorWorkerUrl);
  },
};

if (typeof globalThis !== "undefined") {
  Object.assign(globalThis as { MonacoEnvironment?: unknown }, {
    MonacoEnvironment: monacoEnvironment,
  });
}

loader.config({
  monaco,
});

function defineThemes(instance: typeof monaco) {
  instance.editor.defineTheme("cmux-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
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
