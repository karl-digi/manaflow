// internal/lsp/cli_test.go
package lsp

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestCLI_DiagnosticsResult_JSON tests that DiagnosticsResult serializes correctly
func TestCLI_DiagnosticsResult_JSON(t *testing.T) {
	result := &DiagnosticsResult{
		Diagnostics: []Diagnostic{
			{
				File:      "src/app.tsx",
				Line:      42,
				Column:    10,
				EndLine:   42,
				EndColumn: 20,
				Severity:  "error",
				Message:   "Test error message",
				Code:      "TS2551",
				Source:    "typescript",
			},
		},
	}
	result.Summary.Errors = 1

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal DiagnosticsResult: %v", err)
	}

	// Verify JSON structure
	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if _, ok := parsed["diagnostics"]; !ok {
		t.Error("JSON should have 'diagnostics' field")
	}
	if _, ok := parsed["summary"]; !ok {
		t.Error("JSON should have 'summary' field")
	}
}

// TestCLI_CodeActionResult_JSON tests that CodeActionResult serializes correctly
func TestCLI_CodeActionResult_JSON(t *testing.T) {
	result := &CodeActionResult{
		Location: "src/app.tsx:42:10",
		Actions: []CodeAction{
			{Index: 0, Title: "Fix spelling", Kind: "quickfix"},
			{Index: 1, Title: "Extract function", Kind: "refactor.extract"},
		},
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal CodeActionResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if parsed["location"] != "src/app.tsx:42:10" {
		t.Errorf("Location = %v, want src/app.tsx:42:10", parsed["location"])
	}

	actions, ok := parsed["actions"].([]interface{})
	if !ok || len(actions) != 2 {
		t.Error("Should have 2 actions")
	}
}

// TestCLI_SymbolSearchResult_JSON tests that SymbolSearchResult serializes correctly
func TestCLI_SymbolSearchResult_JSON(t *testing.T) {
	result := &SymbolSearchResult{
		Query: "handleSubmit",
		Symbols: []Symbol{
			{Name: "handleSubmit", Kind: "function", File: "src/form.tsx", Line: 15},
		},
		Total: 1,
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal SymbolSearchResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if parsed["query"] != "handleSubmit" {
		t.Errorf("Query = %v, want handleSubmit", parsed["query"])
	}
	if parsed["total"].(float64) != 1 {
		t.Errorf("Total = %v, want 1", parsed["total"])
	}
}

// TestCLI_DefinitionResult_JSON tests that DefinitionResult serializes correctly
func TestCLI_DefinitionResult_JSON(t *testing.T) {
	result := &DefinitionResult{
		Symbol:   "handleClick",
		Location: "src/app.tsx:42:10",
		Definition: &Location{
			File:    "src/utils.ts",
			Line:    15,
			Column:  1,
			Preview: "export function handleClick() {",
		},
		Type: "function",
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal DefinitionResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if parsed["symbol"] != "handleClick" {
		t.Errorf("Symbol = %v, want handleClick", parsed["symbol"])
	}
	if parsed["type"] != "function" {
		t.Errorf("Type = %v, want function", parsed["type"])
	}
}

// TestCLI_ReferencesResult_JSON tests that ReferencesResult serializes correctly
func TestCLI_ReferencesResult_JSON(t *testing.T) {
	result := &ReferencesResult{
		Symbol: "useState",
		References: []Location{
			{File: "src/app.tsx", Line: 10, Column: 5},
			{File: "src/form.tsx", Line: 20, Column: 3},
		},
		Total: 2,
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal ReferencesResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	refs, ok := parsed["references"].([]interface{})
	if !ok || len(refs) != 2 {
		t.Error("Should have 2 references")
	}
}

// TestCLI_HoverResult_JSON tests that HoverResult serializes correctly
func TestCLI_HoverResult_JSON(t *testing.T) {
	result := &HoverResult{
		Symbol:        "count",
		Type:          "number",
		Documentation: "The current count value",
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal HoverResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if parsed["symbol"] != "count" {
		t.Errorf("Symbol = %v, want count", parsed["symbol"])
	}
	if parsed["type"] != "number" {
		t.Errorf("Type = %v, want number", parsed["type"])
	}
}

// TestCLI_RenameResult_JSON tests that RenameResult serializes correctly
func TestCLI_RenameResult_JSON(t *testing.T) {
	result := &RenameResult{
		OldName:       "foo",
		NewName:       "bar",
		FilesAffected: 3,
		TotalChanges:  10,
		Changes: []RenameChange{
			{File: "src/a.ts", Line: 10, Old: "foo", New: "bar"},
		},
		Applied: true,
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal RenameResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if parsed["old_name"] != "foo" {
		t.Errorf("OldName = %v, want foo", parsed["old_name"])
	}
	if parsed["new_name"] != "bar" {
		t.Errorf("NewName = %v, want bar", parsed["new_name"])
	}
	if parsed["applied"] != true {
		t.Errorf("Applied = %v, want true", parsed["applied"])
	}
}

// TestCLI_FormatResult_JSON tests that FormatResult serializes correctly
func TestCLI_FormatResult_JSON(t *testing.T) {
	result := &FormatResult{
		Formatted:        []string{"a.ts", "b.ts"},
		AlreadyFormatted: []string{"c.ts"},
		Errors:           []string{"d.ts: error"},
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal FormatResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	formatted, ok := parsed["formatted"].([]interface{})
	if !ok || len(formatted) != 2 {
		t.Error("Should have 2 formatted files")
	}
}

// TestCLI_URLResult_JSON tests that URLResult serializes correctly
func TestCLI_URLResult_JSON(t *testing.T) {
	result := GenerateVSCodeURL(10080, "/workspace/project", "src/app.tsx", 42)

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal URLResult: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if _, ok := parsed["url"]; !ok {
		t.Error("JSON should have 'url' field")
	}
	if _, ok := parsed["file_url"]; !ok {
		t.Error("JSON should have 'file_url' field")
	}
}

// TestCLI_AllTextOutput tests all TextOutput methods work correctly
func TestCLI_AllTextOutput(t *testing.T) {
	tests := []struct {
		name   string
		result interface{ TextOutput() string }
	}{
		{
			name: "DiagnosticsResult empty",
			result: &DiagnosticsResult{
				Diagnostics: []Diagnostic{},
			},
		},
		{
			name: "DiagnosticsResult with errors",
			result: &DiagnosticsResult{
				Diagnostics: []Diagnostic{
					{File: "a.ts", Line: 1, Column: 1, Severity: "error", Message: "test"},
				},
			},
		},
		{
			name: "CodeActionResult empty",
			result: &CodeActionResult{
				Location: "file:1:1",
				Actions:  []CodeAction{},
			},
		},
		{
			name: "CodeActionResult with actions",
			result: &CodeActionResult{
				Location: "file:1:1",
				Actions: []CodeAction{
					{Index: 0, Title: "Fix", Kind: "quickfix"},
				},
			},
		},
		{
			name: "ApplyResult applied",
			result: &ApplyResult{
				Applied: true,
				Title:   "Fix applied",
			},
		},
		{
			name: "ApplyResult not applied",
			result: &ApplyResult{
				Applied: false,
				Title:   "Fix",
			},
		},
		{
			name: "SymbolSearchResult empty",
			result: &SymbolSearchResult{
				Query:   "test",
				Symbols: []Symbol{},
			},
		},
		{
			name: "SymbolSearchResult with symbols",
			result: &SymbolSearchResult{
				Query: "test",
				Symbols: []Symbol{
					{Name: "test", Kind: "function", File: "a.ts", Line: 1},
				},
				Total: 1,
			},
		},
		{
			name: "DefinitionResult not found",
			result: &DefinitionResult{
				Symbol:     "test",
				Location:   "file:1:1",
				Definition: nil,
			},
		},
		{
			name: "DefinitionResult found",
			result: &DefinitionResult{
				Symbol:   "test",
				Location: "file:1:1",
				Definition: &Location{
					File: "a.ts", Line: 10, Column: 5,
				},
			},
		},
		{
			name: "ReferencesResult empty",
			result: &ReferencesResult{
				Symbol:     "test",
				References: []Location{},
			},
		},
		{
			name: "ReferencesResult with refs",
			result: &ReferencesResult{
				Symbol: "test",
				References: []Location{
					{File: "a.ts", Line: 10, Column: 5},
				},
				Total: 1,
			},
		},
		{
			name: "HoverResult basic",
			result: &HoverResult{
				Symbol: "test",
			},
		},
		{
			name: "HoverResult full",
			result: &HoverResult{
				Symbol:        "test",
				Type:          "function",
				Documentation: "Test function",
			},
		},
		{
			name: "RenameResult dry run",
			result: &RenameResult{
				OldName: "old",
				NewName: "new",
				Applied: false,
			},
		},
		{
			name: "RenameResult applied",
			result: &RenameResult{
				OldName: "old",
				NewName: "new",
				Applied: true,
			},
		},
		{
			name: "FormatResult formatted",
			result: &FormatResult{
				Formatted: []string{"a.ts"},
			},
		},
		{
			name: "FormatResult errors",
			result: &FormatResult{
				Errors: []string{"error"},
			},
		},
		{
			name:   "URLResult",
			result: GenerateVSCodeURL(10080, "/workspace", "", 0),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			output := tt.result.TextOutput()
			if output == "" {
				t.Error("TextOutput should not return empty string")
			}
			// Verify it's human-readable (not JSON)
			if strings.HasPrefix(output, "{") {
				t.Error("TextOutput should not return JSON")
			}
		})
	}
}

// TestCLI_DiagnosticSeverityIcons tests that severity icons are correct
func TestCLI_DiagnosticSeverityIcons(t *testing.T) {
	severities := []string{"error", "warning", "info", "hint"}

	for _, sev := range severities {
		result := &DiagnosticsResult{
			Diagnostics: []Diagnostic{
				{File: "a.ts", Line: 1, Column: 1, Severity: sev, Message: "test"},
			},
		}

		output := result.TextOutput()
		var expectedIcon string
		switch sev {
		case "error":
			expectedIcon = "E "
		case "warning":
			expectedIcon = "W "
		case "info":
			expectedIcon = "I "
		case "hint":
			expectedIcon = "H "
		}

		if !strings.Contains(output, expectedIcon) {
			t.Errorf("TextOutput for severity %s should contain icon %q", sev, expectedIcon)
		}
	}
}

// TestCLI_ParseLocation_RoundTrip tests that ParseLocation and FormatLocation are consistent
func TestCLI_ParseLocation_RoundTrip(t *testing.T) {
	tests := []struct {
		file   string
		line   int
		column int
	}{
		{"src/app.tsx", 42, 10},
		{"a.ts", 1, 1},
		{"very/deep/nested/path/file.ts", 100, 50},
		{"file with spaces.ts", 10, 5},
	}

	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			formatted := FormatLocation(tt.file, tt.line, tt.column)
			parsedFile, parsedLine, parsedCol, err := ParseLocation(formatted)
			if err != nil {
				t.Fatalf("ParseLocation failed: %v", err)
			}
			if parsedFile != tt.file {
				t.Errorf("File = %v, want %v", parsedFile, tt.file)
			}
			if parsedLine != tt.line {
				t.Errorf("Line = %v, want %v", parsedLine, tt.line)
			}
			if parsedCol != tt.column {
				t.Errorf("Column = %v, want %v", parsedCol, tt.column)
			}
		})
	}
}

// TestCLI_URLResult_URLFormat tests URL format is correct
func TestCLI_URLResult_URLFormat(t *testing.T) {
	result := GenerateVSCodeURL(10080, "/workspace/project", "src/app.tsx", 42)

	// Check base URL format
	if !strings.HasPrefix(result.URL, "http://localhost:10080/") {
		t.Errorf("URL should start with http://localhost:10080/, got %s", result.URL)
	}

	// Check URL contains folder parameter
	if !strings.Contains(result.URL, "folder=") {
		t.Error("URL should contain folder parameter")
	}

	// Check file URL contains file parameter
	if !strings.Contains(result.FileURL, "file=") {
		t.Error("FileURL should contain file parameter")
	}

	// Check file URL contains line parameter
	if !strings.Contains(result.FileURL, "line=42") {
		t.Error("FileURL should contain line=42 parameter")
	}
}
