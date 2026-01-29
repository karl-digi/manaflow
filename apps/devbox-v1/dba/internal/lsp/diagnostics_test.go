// internal/lsp/diagnostics_test.go
package lsp

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseTypeScriptOutput(t *testing.T) {
	tests := []struct {
		name    string
		output  string
		wantLen int
	}{
		{
			name: "single error",
			output: `src/app.tsx(42,10): error TS2551: Property 'emial' does not exist on type 'User'. Did you mean 'email'?
`,
			wantLen: 1,
		},
		{
			name: "multiple errors",
			output: `src/app.tsx(42,10): error TS2551: Property 'emial' does not exist on type 'User'. Did you mean 'email'?
src/utils.ts(10,5): error TS2304: Cannot find name 'foo'.
`,
			wantLen: 2,
		},
		{
			name:    "no errors",
			output:  "",
			wantLen: 0,
		},
		{
			name: "warning",
			output: `src/app.tsx(42,10): warning TS6133: 'x' is declared but never used.
`,
			wantLen: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diags, err := parseTypeScriptOutput(tt.output, "/project")
			if err != nil {
				t.Errorf("parseTypeScriptOutput() error = %v", err)
				return
			}
			if len(diags) != tt.wantLen {
				t.Errorf("parseTypeScriptOutput() len = %v, want %v", len(diags), tt.wantLen)
			}
		})
	}
}

func TestParseTypeScriptOutput_Fields(t *testing.T) {
	output := `src/app.tsx(42,10): error TS2551: Property 'emial' does not exist on type 'User'. Did you mean 'email'?
`
	diags, err := parseTypeScriptOutput(output, "/project")
	if err != nil {
		t.Fatalf("parseTypeScriptOutput() error = %v", err)
	}
	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}

	d := diags[0]
	if d.File != "src/app.tsx" {
		t.Errorf("File = %v, want src/app.tsx", d.File)
	}
	if d.Line != 42 {
		t.Errorf("Line = %v, want 42", d.Line)
	}
	if d.Column != 10 {
		t.Errorf("Column = %v, want 10", d.Column)
	}
	if d.Severity != "error" {
		t.Errorf("Severity = %v, want error", d.Severity)
	}
	if d.Code != "TS2551" {
		t.Errorf("Code = %v, want TS2551", d.Code)
	}
	if d.Source != "typescript" {
		t.Errorf("Source = %v, want typescript", d.Source)
	}
}

func TestParseESLintOutput(t *testing.T) {
	tests := []struct {
		name    string
		output  string
		wantLen int
	}{
		{
			name: "single file with errors",
			output: `[
				{
					"filePath": "/project/src/app.tsx",
					"messages": [
						{
							"line": 10,
							"column": 5,
							"severity": 2,
							"message": "Unexpected console statement",
							"ruleId": "no-console"
						}
					]
				}
			]`,
			wantLen: 1,
		},
		{
			name:    "empty array",
			output:  "[]",
			wantLen: 0,
		},
		{
			name: "warning",
			output: `[
				{
					"filePath": "/project/src/app.tsx",
					"messages": [
						{
							"line": 10,
							"column": 5,
							"severity": 1,
							"message": "Warning message",
							"ruleId": "some-rule"
						}
					]
				}
			]`,
			wantLen: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diags, err := parseESLintOutput([]byte(tt.output), "/project")
			if err != nil {
				t.Errorf("parseESLintOutput() error = %v", err)
				return
			}
			if len(diags) != tt.wantLen {
				t.Errorf("parseESLintOutput() len = %v, want %v", len(diags), tt.wantLen)
			}
		})
	}
}

func TestFilterDiagnostics(t *testing.T) {
	diags := []Diagnostic{
		{File: "src/app.tsx", Severity: "error", Source: "typescript"},
		{File: "src/utils.ts", Severity: "warning", Source: "eslint"},
		{File: "src/app.tsx", Severity: "warning", Source: "eslint"},
	}

	tests := []struct {
		name    string
		opts    DiagnosticsOptions
		wantLen int
	}{
		{
			name:    "no filter",
			opts:    DiagnosticsOptions{},
			wantLen: 3,
		},
		{
			name:    "filter by file",
			opts:    DiagnosticsOptions{File: "src/app.tsx"},
			wantLen: 2,
		},
		{
			name:    "filter by severity",
			opts:    DiagnosticsOptions{Severity: "error"},
			wantLen: 1,
		},
		{
			name:    "filter by source",
			opts:    DiagnosticsOptions{Source: "eslint"},
			wantLen: 2,
		},
		{
			name:    "combined filter",
			opts:    DiagnosticsOptions{File: "src/app.tsx", Severity: "warning"},
			wantLen: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filtered := filterDiagnostics(diags, tt.opts)
			if len(filtered) != tt.wantLen {
				t.Errorf("filterDiagnostics() len = %v, want %v", len(filtered), tt.wantLen)
			}
		})
	}
}

func TestDiagnosticsResult_TextOutput(t *testing.T) {
	result := &DiagnosticsResult{
		Diagnostics: []Diagnostic{
			{File: "src/app.tsx", Line: 42, Column: 10, Severity: "error", Message: "Test error", Code: "TS2551", Source: "typescript"},
		},
	}
	result.Summary.Errors = 1

	output := result.TextOutput()
	if !strings.Contains(output, "src/app.tsx:42:10") {
		t.Error("TextOutput should contain file location")
	}
	if !strings.Contains(output, "Test error") {
		t.Error("TextOutput should contain message")
	}
	if !strings.Contains(output, "1 errors") {
		t.Error("TextOutput should contain summary")
	}
}

func TestDiagnosticsResult_TextOutput_NoDiagnostics(t *testing.T) {
	result := &DiagnosticsResult{
		Diagnostics: []Diagnostic{},
	}

	output := result.TextOutput()
	if !strings.Contains(output, "No diagnostics found") {
		t.Error("TextOutput should indicate no diagnostics")
	}
}

func TestDiagnosticsResult_TextOutput_AllSeverities(t *testing.T) {
	result := &DiagnosticsResult{
		Diagnostics: []Diagnostic{
			{File: "a.ts", Line: 1, Column: 1, Severity: "error", Message: "err"},
			{File: "b.ts", Line: 1, Column: 1, Severity: "warning", Message: "warn"},
			{File: "c.ts", Line: 1, Column: 1, Severity: "info", Message: "inf"},
			{File: "d.ts", Line: 1, Column: 1, Severity: "hint", Message: "hnt"},
		},
	}
	result.Summary.Errors = 1
	result.Summary.Warnings = 1
	result.Summary.Info = 1
	result.Summary.Hint = 1

	output := result.TextOutput()
	if !strings.Contains(output, "E ") {
		t.Error("TextOutput should show error icon")
	}
	if !strings.Contains(output, "W ") {
		t.Error("TextOutput should show warning icon")
	}
	if !strings.Contains(output, "I ") {
		t.Error("TextOutput should show info icon")
	}
	if !strings.Contains(output, "H ") {
		t.Error("TextOutput should show hint icon")
	}
}

func TestParseTypeScriptOutput_PathsWithSpaces(t *testing.T) {
	output := `src/my app/component.tsx(10,5): error TS2551: Some error message
`
	diags, err := parseTypeScriptOutput(output, "/project")
	if err != nil {
		t.Fatalf("parseTypeScriptOutput() error = %v", err)
	}
	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}
	if diags[0].File != "src/my app/component.tsx" {
		t.Errorf("File = %v, want 'src/my app/component.tsx'", diags[0].File)
	}
}

func TestParseTypeScriptOutput_MultiLineOutput(t *testing.T) {
	output := `src/a.ts(1,1): error TS1001: Error 1
src/b.ts(2,2): error TS1002: Error 2
src/c.ts(3,3): error TS1003: Error 3
src/d.ts(4,4): warning TS1004: Warning 1
`
	diags, err := parseTypeScriptOutput(output, "/project")
	if err != nil {
		t.Fatalf("parseTypeScriptOutput() error = %v", err)
	}
	if len(diags) != 4 {
		t.Errorf("expected 4 diagnostics, got %d", len(diags))
	}
}

func TestParseTypeScriptOutput_InvalidLines(t *testing.T) {
	output := `This is not a valid TypeScript error
src/app.tsx(42,10): error TS2551: Valid error
Another invalid line
`
	diags, err := parseTypeScriptOutput(output, "/project")
	if err != nil {
		t.Fatalf("parseTypeScriptOutput() error = %v", err)
	}
	// Should only parse the valid line
	if len(diags) != 1 {
		t.Errorf("expected 1 diagnostic, got %d", len(diags))
	}
}

func TestParseESLintOutput_MultipleFiles(t *testing.T) {
	output := `[
		{
			"filePath": "/project/src/a.tsx",
			"messages": [
				{"line": 1, "column": 1, "severity": 2, "message": "Error 1", "ruleId": "rule-1"}
			]
		},
		{
			"filePath": "/project/src/b.tsx",
			"messages": [
				{"line": 2, "column": 2, "severity": 1, "message": "Warning 1", "ruleId": "rule-2"},
				{"line": 3, "column": 3, "severity": 2, "message": "Error 2", "ruleId": "rule-3"}
			]
		}
	]`
	diags, err := parseESLintOutput([]byte(output), "/project")
	if err != nil {
		t.Fatalf("parseESLintOutput() error = %v", err)
	}
	if len(diags) != 3 {
		t.Errorf("expected 3 diagnostics, got %d", len(diags))
	}
}

func TestParseESLintOutput_WithEndLocation(t *testing.T) {
	output := `[
		{
			"filePath": "/project/src/app.tsx",
			"messages": [
				{
					"line": 10,
					"column": 5,
					"endLine": 10,
					"endColumn": 15,
					"severity": 2,
					"message": "Error with range",
					"ruleId": "some-rule"
				}
			]
		}
	]`
	diags, err := parseESLintOutput([]byte(output), "/project")
	if err != nil {
		t.Fatalf("parseESLintOutput() error = %v", err)
	}
	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}
	if diags[0].EndLine != 10 {
		t.Errorf("EndLine = %v, want 10", diags[0].EndLine)
	}
	if diags[0].EndColumn != 15 {
		t.Errorf("EndColumn = %v, want 15", diags[0].EndColumn)
	}
}

func TestParseESLintOutput_InvalidJSON(t *testing.T) {
	output := `{invalid json`
	_, err := parseESLintOutput([]byte(output), "/project")
	if err == nil {
		t.Error("parseESLintOutput should error on invalid JSON")
	}
}

func TestParseESLintOutput_EmptyInput(t *testing.T) {
	diags, err := parseESLintOutput([]byte(""), "/project")
	if err != nil {
		t.Errorf("parseESLintOutput should handle empty input: %v", err)
	}
	if diags != nil && len(diags) != 0 {
		t.Errorf("expected empty diagnostics for empty input")
	}
}

func TestFilterDiagnostics_AllFilters(t *testing.T) {
	diags := []Diagnostic{
		{File: "src/app.tsx", Severity: "error", Source: "typescript"},
		{File: "src/app.tsx", Severity: "error", Source: "eslint"},
		{File: "src/app.tsx", Severity: "warning", Source: "typescript"},
		{File: "src/utils.ts", Severity: "error", Source: "typescript"},
	}

	opts := DiagnosticsOptions{
		File:     "src/app.tsx",
		Severity: "error",
		Source:   "typescript",
	}
	filtered := filterDiagnostics(diags, opts)
	if len(filtered) != 1 {
		t.Errorf("expected 1 diagnostic, got %d", len(filtered))
	}
}

func TestFilterDiagnostics_NoMatch(t *testing.T) {
	diags := []Diagnostic{
		{File: "src/app.tsx", Severity: "error", Source: "typescript"},
	}

	opts := DiagnosticsOptions{
		File: "nonexistent.ts",
	}
	filtered := filterDiagnostics(diags, opts)
	if len(filtered) != 0 {
		t.Errorf("expected 0 diagnostics, got %d", len(filtered))
	}
}

func TestDiagnostic_JSON(t *testing.T) {
	diag := Diagnostic{
		File:      "src/app.tsx",
		Line:      42,
		Column:    10,
		EndLine:   42,
		EndColumn: 20,
		Severity:  "error",
		Message:   "Test error",
		Code:      "TS2551",
		Source:    "typescript",
	}

	// Test that it marshals to JSON correctly
	data, err := json.Marshal(diag)
	if err != nil {
		t.Fatalf("Failed to marshal Diagnostic: %v", err)
	}

	var unmarshaled Diagnostic
	err = json.Unmarshal(data, &unmarshaled)
	if err != nil {
		t.Fatalf("Failed to unmarshal Diagnostic: %v", err)
	}

	if unmarshaled.File != diag.File {
		t.Errorf("File = %v, want %v", unmarshaled.File, diag.File)
	}
	if unmarshaled.Message != diag.Message {
		t.Errorf("Message = %v, want %v", unmarshaled.Message, diag.Message)
	}
}

func TestDiagnosticsOptions_Empty(t *testing.T) {
	diags := []Diagnostic{
		{File: "a.ts", Severity: "error", Source: "typescript"},
		{File: "b.ts", Severity: "warning", Source: "eslint"},
	}

	// Empty options should return all diagnostics
	filtered := filterDiagnostics(diags, DiagnosticsOptions{})
	if len(filtered) != 2 {
		t.Errorf("expected 2 diagnostics with empty options, got %d", len(filtered))
	}
}
