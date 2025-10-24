# PR Review Strategies

This directory powers the automated PR-review inject script. The pipeline is
now strategy-based, so we can experiment with multiple prompting/output styles
without rewriting the harness.

## Current Strategies

| ID              | Description                                                                                   | Output                                                               |
|-----------------|-----------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| `json-lines`       | Original flow. The LLM returns JSON objects containing the literal line text plus metadata.   | `lines[].line`, `shouldBeReviewedScore`, `shouldReviewWhy`, `mostImportantCharacterIndex` |
| `line-numbers`     | Similar to the original, but the model references diff line numbers instead of echoing code. | `lines[].lineNumber` (optional `line`), score/index required         |
| `inline-phrase`    | Lines end with `// review <score> "phrase_with_underscores" <optional comment>` (lowercase). | Annotated diff plus parsed phrase annotations                        |
| `inline-brackets`  | Highlights spans with `{| … |}` and appends `// review <score> <optional comment>`.           | Annotated diff plus parsed highlight spans                           |

All strategies implement the common interface in `core/types.ts`. The active
strategy is selected via `CMUX_PR_REVIEW_STRATEGY` or the CLI flag
`--strategy <json-lines|line-numbers|inline-phrase|inline-brackets>`.

## Configuration

Environment variables (and matching CLI flags) understood by the inject script:

| Env / Flag                                   | Purpose                                                                                 | Default      |
|----------------------------------------------|-----------------------------------------------------------------------------------------|--------------|
| `CMUX_PR_REVIEW_STRATEGY` / `--strategy`      | Strategy ID to use                                                                      | `json-lines` |
| `CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS` / `--diff-line-numbers` | Include formatted line numbers in prompts/logs                              | `false`      |
| `CMUX_PR_REVIEW_SHOW_CONTEXT_LINE_NUMBERS` / `--diff-context-line-numbers` | Include numbers on unchanged diff lines               | `true`       |
| `CMUX_PR_REVIEW_DIFF_ARTIFACT_MODE` / `--diff-artifact <single|per-file>` | How to persist diff artifacts (`inline-phrase` / `inline-brackets` often use `single`) | `per-file`   |
| `CMUX_PR_REVIEW_ARTIFACTS_DIR`                | Root directory for run artifacts                                                        | `${WORKSPACE}/.cmux-pr-review-artifacts` |

See `core/options.ts` for the full option loader.

## Supporting Modules

- `core/options.ts`: Parses environment/CLI config into a typed `PrReviewOptions`.
- `core/types.ts`: Shared type definitions for strategy hooks.
- `diff-utils.ts`: Pure TypeScript diff formatter (no external processes).
- `strategies/`: Individual strategy implementations.

### Execution Model

Each file review runs through the selected strategy concurrently (the inject
script maps over files and awaits `Promise.all`). Switching strategies only
changes how each file is evaluated, not the level of parallelism.

## Inline-Comment Format

### Phrase strategy

Lines must end with:

```
// review <score> "phrase_with_underscores" <optional comment>
```

Always include the score (0-1). Replace spaces in the phrase with underscores so
the parser can capture it.

### Bracket strategy

Wrap the critical span inline using `{|` and `|}`, then append:

```
// review <score> <optional comment>
```

Scores are mandatory; comments are optional. Parsed annotations capture either
the phrase or the bracketed highlight.

## Demo Harness

`run-strategy-demo.ts` fetches PR [#709](https://github.com/manaflow-ai/cmux/pull/709/files),
runs each strategy with synthetic model outputs, and stores prompts/responses
under `tmp/strategy-demo/`. This is useful for quick smoke tests without
calling the OpenAI API:

```
bun run apps/www/scripts/pr-review/run-strategy-demo.ts
```

## Running the Inject Script

Local Docker (recommended):

```
# JSON (line text)
bun run apps/www/scripts/pr-review-local.ts --strategy json-lines <PR_URL>

# JSON (line numbers)
bun run apps/www/scripts/pr-review-local.ts --strategy line-numbers --diff-line-numbers <PR_URL>

# Inline comments with aggregated diff artifacts
bun run apps/www/scripts/pr-review-local.ts \
  --strategy inline-phrase \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>
```

The direct harness (`pr-review.ts`) should be used only when you explicitly
need to target a remote Morph instance:

```
# JSON (line text)
bun run apps/www/scripts/pr-review.ts --strategy json-lines <PR_URL>

# JSON (line numbers)
bun run apps/www/scripts/pr-review.ts --strategy line-numbers --diff-line-numbers <PR_URL>

# Inline comments with aggregated diff artifacts
bun run apps/www/scripts/pr-review.ts \
  --strategy inline-phrase \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>
```

Both runners accept identical flags; the local Docker variant is the default
path for testing. Artifacts are written beneath `CMUX_PR_REVIEW_ARTIFACTS_DIR`
and referenced in the final `code-review-output.json`.
