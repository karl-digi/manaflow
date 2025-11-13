import {
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  GutterMarker,
  lineNumberMarkers,
} from "@codemirror/view";
import { getChunks } from "@codemirror/merge";

export const LINE_NUMBER_ADDITION_CLASS = "cm-lineNumber-addition";
export const LINE_NUMBER_DELETION_CLASS = "cm-lineNumber-deletion";

const additionLineNumberMarker = new (class extends GutterMarker {
  override elementClass = LINE_NUMBER_ADDITION_CLASS;
})();

const deletionLineNumberMarker = new (class extends GutterMarker {
  override elementClass = LINE_NUMBER_DELETION_CLASS;
})();

function computeLineNumberMarkers(state: EditorState): RangeSet<GutterMarker> {
  const info = getChunks(state);
  if (!info || info.side == null || info.chunks.length === 0) {
    return RangeSet.empty;
  }

  const doc = state.doc;
  const marker =
    info.side === "a" ? deletionLineNumberMarker : additionLineNumberMarker;
  const builder = new RangeSetBuilder<GutterMarker>();

  for (const chunk of info.chunks) {
    const rawFrom = info.side === "a" ? chunk.fromA : chunk.fromB;
    const rawTo = info.side === "a" ? chunk.toA : chunk.toB;
    if (rawTo <= rawFrom) {
      continue;
    }

    const from = Math.max(0, Math.min(rawFrom, doc.length));
    const to = Math.max(from, Math.min(rawTo, doc.length));

    let line = doc.lineAt(from);
    builder.add(line.from, line.from, marker);

    if (line.to >= to) {
      continue;
    }

    while (line.to < to && line.number < doc.lines) {
      line = doc.line(line.number + 1);
      builder.add(line.from, line.from, marker);
    }
  }

  return builder.finish();
}

const DiffLineNumberMarkers = StateField.define<RangeSet<GutterMarker>>({
  create(state) {
    return computeLineNumberMarkers(state);
  },
  update(value, tr) {
    const prev = getChunks(tr.startState);
    const next = getChunks(tr.state);
    const chunksChanged =
      (prev?.chunks ?? null) !== (next?.chunks ?? null) ||
      prev?.side !== next?.side;

    if (tr.docChanged || chunksChanged) {
      return computeLineNumberMarkers(tr.state);
    }

    return value;
  },
  provide: (field) => lineNumberMarkers.from(field),
});

export const diffLineNumberMarkers = DiffLineNumberMarkers;
