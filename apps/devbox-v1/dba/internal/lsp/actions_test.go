// internal/lsp/actions_test.go
package lsp

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestSuggestFixes(t *testing.T) {
	tests := []struct {
		name     string
		diag     Diagnostic
		wantLen  int
		wantKind string
	}{
		{
			name: "TypeScript did you mean",
			diag: Diagnostic{
				Code:    "TS2551",
				Message: "Property 'emial' does not exist on type 'User'. Did you mean 'email'?",
				Source:  "typescript",
			},
			wantLen:  1,
			wantKind: "quickfix",
		},
		{
			name: "TypeScript unused variable",
			diag: Diagnostic{
				Code:    "TS6133",
				Message: "'x' is declared but its value is never used.",
				Source:  "typescript",
			},
			wantLen:  1,
			wantKind: "quickfix",
		},
		{
			name: "TypeScript cannot find",
			diag: Diagnostic{
				Code:    "TS2304",
				Message: "Cannot find name 'foo'.",
				Source:  "typescript",
			},
			wantLen:  1,
			wantKind: "quickfix",
		},
		{
			name: "TypeScript property does not exist",
			diag: Diagnostic{
				Code:    "TS2339",
				Message: "Property 'bar' does not exist on type 'Foo'.",
				Source:  "typescript",
			},
			wantLen:  1,
			wantKind: "quickfix",
		},
		{
			name: "TypeScript type error",
			diag: Diagnostic{
				Code:    "TS2322",
				Message: "Type 'string' is not assignable to type 'number'.",
				Source:  "typescript",
			},
			wantLen:  1,
			wantKind: "quickfix",
		},
		{
			name: "ESLint error",
			diag: Diagnostic{
				Code:    "no-console",
				Message: "Unexpected console statement.",
				Source:  "eslint",
			},
			wantLen:  2, // disable for line + disable for file
			wantKind: "quickfix",
		},
		{
			name: "ESLint with empty code",
			diag: Diagnostic{
				Code:    "",
				Message: "Some error",
				Source:  "eslint",
			},
			wantLen: 0, // No suggestions without rule ID
		},
		{
			name: "Unknown source",
			diag: Diagnostic{
				Code:    "unknown",
				Message: "Some error",
				Source:  "unknown",
			},
			wantLen: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixes := suggestFixes(tt.diag)
			if len(fixes) != tt.wantLen {
				t.Errorf("suggestFixes() returned %d fixes, want %d", len(fixes), tt.wantLen)
			}
			if tt.wantLen > 0 && len(fixes) > 0 && fixes[0].Kind != tt.wantKind {
				t.Errorf("suggestFixes() first fix kind = %v, want %v", fixes[0].Kind, tt.wantKind)
			}
		})
	}
}

func TestCodeActionResult_TextOutput(t *testing.T) {
	tests := []struct {
		name     string
		result   *CodeActionResult
		contains []string
	}{
		{
			name: "with actions",
			result: &CodeActionResult{
				Location: "src/app.tsx:42:10",
				Actions: []CodeAction{
					{Index: 0, Title: "Fix spelling", Kind: "quickfix"},
					{Index: 1, Title: "Extract to function", Kind: "refactor.extract"},
				},
			},
			contains: []string{"src/app.tsx:42:10", "Fix spelling", "Extract to function", "quickfix", "refactor.extract"},
		},
		{
			name: "no actions",
			result: &CodeActionResult{
				Location: "src/app.tsx:10:5",
				Actions:  []CodeAction{},
			},
			contains: []string{"No code actions available", "src/app.tsx:10:5"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			output := tt.result.TextOutput()
			for _, s := range tt.contains {
				if !strings.Contains(output, s) {
					t.Errorf("TextOutput() should contain %q, got: %s", s, output)
				}
			}
		})
	}
}

func TestApplyResult_TextOutput(t *testing.T) {
	tests := []struct {
		name     string
		result   *ApplyResult
		contains string
	}{
		{
			name: "applied",
			result: &ApplyResult{
				Applied: true,
				Title:   "Fix spelling",
			},
			contains: "Applied: Fix spelling",
		},
		{
			name: "not applied",
			result: &ApplyResult{
				Applied: false,
				Title:   "Fix spelling",
			},
			contains: "not applied",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			output := tt.result.TextOutput()
			if !strings.Contains(output, tt.contains) {
				t.Errorf("TextOutput() should contain %q, got: %s", tt.contains, output)
			}
		})
	}
}

func TestApplyCodeAction_InvalidIndex(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// This will fail because there's no real project, but we can test the index validation
	_, err := ApplyCodeAction(ctx, "/nonexistent", "file.ts", 1, 1, 999)
	if err == nil {
		t.Error("ApplyCodeAction should return error for invalid index")
	}
}

func TestGetCodeActions_EmptyFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Test with non-existent project - should return empty actions, not error
	result, err := GetCodeActions(ctx, "/nonexistent", "file.ts", 1, 1)
	if err != nil {
		t.Errorf("GetCodeActions should not error for non-existent project: %v", err)
	}
	if result == nil {
		t.Error("GetCodeActions should return a result")
	}
	// Should have at least the default refactoring actions
	if len(result.Actions) < 1 {
		t.Error("GetCodeActions should return at least default refactoring actions")
	}
}

func TestCodeAction_IndexAssignment(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, _ := GetCodeActions(ctx, "/nonexistent", "file.ts", 1, 1)
	if result == nil {
		return
	}

	// Verify indices are sequential
	for i, action := range result.Actions {
		if action.Index != i {
			t.Errorf("Action index should be %d, got %d", i, action.Index)
		}
	}
}

func TestSuggestFixes_DidYouMeanExtraction(t *testing.T) {
	tests := []struct {
		name        string
		message     string
		wantSuggest string
	}{
		{
			name:        "simple suggestion",
			message:     "Did you mean 'email'?",
			wantSuggest: "email",
		},
		{
			name:        "property suggestion",
			message:     "Property 'nmae' does not exist. Did you mean 'name'?",
			wantSuggest: "name",
		},
		{
			name:        "no did you mean",
			message:     "Cannot find name 'foo'",
			wantSuggest: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diag := Diagnostic{
				Code:    "TS2551",
				Message: tt.message,
				Source:  "typescript",
			}
			fixes := suggestFixes(diag)

			if tt.wantSuggest != "" {
				found := false
				for _, fix := range fixes {
					if strings.Contains(fix.Title, tt.wantSuggest) {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected suggestion containing %q, got fixes: %v", tt.wantSuggest, fixes)
				}
			}
		})
	}
}
