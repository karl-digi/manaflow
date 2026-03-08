package plan

import (
	"strings"
	"testing"
)

func TestParsePlanMarkdownWithH2Sections(t *testing.T) {
	input := `# Plan: Import markdown plans

## Parser
Build parser utility.

## UI
Build import dialog.
`

	items := ParsePlanMarkdown(input)
	if len(items) != 2 {
		t.Fatalf("got %d items, want 2", len(items))
	}

	if items[0].Title != "Parser" {
		t.Fatalf("first title = %q, want %q", items[0].Title, "Parser")
	}
	if items[0].Body != "Build parser utility." {
		t.Fatalf("first body = %q, want %q", items[0].Body, "Build parser utility.")
	}
	if items[1].Title != "UI" {
		t.Fatalf("second title = %q, want %q", items[1].Title, "UI")
	}
	if items[1].Body != "Build import dialog." {
		t.Fatalf("second body = %q, want %q", items[1].Body, "Build import dialog.")
	}
}

func TestParsePlanMarkdownFallbackWithoutH2(t *testing.T) {
	input := `# Plan: Single fallback plan

- [ ] Do the thing
- [ ] Verify it
`

	items := ParsePlanMarkdown(input)
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1", len(items))
	}

	if items[0].Title != "Single fallback plan" {
		t.Fatalf("fallback title = %q, want %q", items[0].Title, "Single fallback plan")
	}

	expectedBody := strings.TrimSpace(input)
	if items[0].Body != expectedBody {
		t.Fatalf("fallback body mismatch\n got: %q\nwant: %q", items[0].Body, expectedBody)
	}
}

func TestParsePlanMarkdownEmptyInput(t *testing.T) {
	if items := ParsePlanMarkdown(""); len(items) != 0 {
		t.Fatalf("empty input should return 0 items, got %d", len(items))
	}
	if items := ParsePlanMarkdown(" \n\t "); len(items) != 0 {
		t.Fatalf("whitespace input should return 0 items, got %d", len(items))
	}
}

func TestParsePlanMarkdownPreservesChecklist(t *testing.T) {
	input := `# Plan: Checklist preservation

## Backend
- [ ] Add endpoint
- [ ] Add schema
`

	items := ParsePlanMarkdown(input)
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1", len(items))
	}
	if items[0].Title != "Backend" {
		t.Fatalf("title = %q, want %q", items[0].Title, "Backend")
	}
	if !strings.Contains(items[0].Body, "- [ ] Add endpoint") {
		t.Fatalf("expected checklist item in body, got: %q", items[0].Body)
	}
	if !strings.Contains(items[0].Body, "- [ ] Add schema") {
		t.Fatalf("expected checklist item in body, got: %q", items[0].Body)
	}
}
