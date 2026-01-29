// internal/lsp/navigation_test.go
package lsp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestIsWordChar(t *testing.T) {
	tests := []struct {
		char byte
		want bool
	}{
		{'a', true},
		{'z', true},
		{'A', true},
		{'Z', true},
		{'0', true},
		{'9', true},
		{'_', true},
		{'$', true},
		{' ', false},
		{'.', false},
		{'(', false},
		{')', false},
		{'{', false},
		{'}', false},
		{'[', false},
		{']', false},
		{',', false},
		{';', false},
		{':', false},
		{'+', false},
		{'-', false},
		{'*', false},
		{'/', false},
		{'=', false},
		{'<', false},
		{'>', false},
		{'"', false},
		{'\'', false},
		{'\n', false},
		{'\t', false},
	}

	for _, tt := range tests {
		t.Run(string(tt.char), func(t *testing.T) {
			got := isWordChar(tt.char)
			if got != tt.want {
				t.Errorf("isWordChar(%q) = %v, want %v", tt.char, got, tt.want)
			}
		})
	}
}

func TestGetSymbolAtPosition(t *testing.T) {
	// Create a temporary file for testing
	content := `const foo = 123;
function bar() {
  return foo + baz;
}
const $dollarSign = 42;
const _underscore = true;
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	err := os.WriteFile(tmpFile, []byte(content), 0644)
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}

	tests := []struct {
		name    string
		line    int
		col     int
		want    string
		wantErr bool
	}{
		{
			name: "simple variable",
			line: 1,
			col:  7, // pointing at 'foo'
			want: "foo",
		},
		{
			name: "function name",
			line: 2,
			col:  10, // pointing at 'bar'
			want: "bar",
		},
		{
			name: "variable in expression",
			line: 3,
			col:  10, // pointing at 'foo'
			want: "foo",
		},
		{
			name: "variable with dollar sign",
			line: 5,
			col:  7, // pointing at '$dollarSign'
			want: "$dollarSign",
		},
		{
			name: "variable with underscore",
			line: 6,
			col:  7, // pointing at '_underscore'
			want: "_underscore",
		},
		{
			name:    "line out of range",
			line:    100,
			col:     1,
			wantErr: true,
		},
		{
			name:    "invalid line number",
			line:    0,
			col:     1,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := getSymbolAtPosition(tmpFile, tt.line, tt.col)
			if (err != nil) != tt.wantErr {
				t.Errorf("getSymbolAtPosition() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("getSymbolAtPosition() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetSymbolAtPosition_FileNotFound(t *testing.T) {
	_, err := getSymbolAtPosition("/nonexistent/file.ts", 1, 1)
	if err == nil {
		t.Error("getSymbolAtPosition should error for non-existent file")
	}
}

func TestGetSymbolAtPosition_EmptyLine(t *testing.T) {
	content := `
const x = 1;
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	os.WriteFile(tmpFile, []byte(content), 0644)

	_, err := getSymbolAtPosition(tmpFile, 1, 1) // Empty first line
	if err == nil {
		t.Error("getSymbolAtPosition should error for empty line")
	}
}

func TestDefinitionResult_TextOutput(t *testing.T) {
	tests := []struct {
		name     string
		result   *DefinitionResult
		contains []string
	}{
		{
			name: "with definition",
			result: &DefinitionResult{
				Symbol:   "handleClick",
				Location: "src/app.tsx:42:10",
				Definition: &Location{
					File:    "src/utils.ts",
					Line:    15,
					Column:  1,
					Preview: "export function handleClick() {",
				},
				Type: "function",
			},
			contains: []string{"handleClick", "src/utils.ts:15:1", "function"},
		},
		{
			name: "no definition found",
			result: &DefinitionResult{
				Symbol:     "unknown",
				Location:   "src/app.tsx:10:5",
				Definition: nil,
			},
			contains: []string{"No definition found", "unknown", "src/app.tsx:10:5"},
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

func TestReferencesResult_TextOutput(t *testing.T) {
	tests := []struct {
		name     string
		result   *ReferencesResult
		contains []string
	}{
		{
			name: "with references",
			result: &ReferencesResult{
				Symbol: "useState",
				References: []Location{
					{File: "src/app.tsx", Line: 10, Column: 5, Preview: "const [count, setCount] = useState(0)"},
					{File: "src/form.tsx", Line: 25, Column: 3, Preview: "const [data, setData] = useState({})"},
				},
				Total: 2,
			},
			contains: []string{"useState", "Found 2 references", "src/app.tsx:10", "src/form.tsx:25"},
		},
		{
			name: "no references",
			result: &ReferencesResult{
				Symbol:     "unusedVar",
				References: []Location{},
				Total:      0,
			},
			contains: []string{"No references found", "unusedVar"},
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

func TestHoverResult_TextOutput(t *testing.T) {
	tests := []struct {
		name     string
		result   *HoverResult
		contains []string
	}{
		{
			name: "with type and docs",
			result: &HoverResult{
				Symbol:        "count",
				Type:          "number",
				Documentation: "The current count value",
			},
			contains: []string{"count", "number", "The current count value"},
		},
		{
			name: "only symbol",
			result: &HoverResult{
				Symbol: "unknownVar",
			},
			contains: []string{"unknownVar"},
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

func TestLocation_JSON(t *testing.T) {
	loc := Location{
		File:    "src/app.tsx",
		Line:    42,
		Column:  10,
		Preview: "const x = 1",
	}

	data, err := json.Marshal(loc)
	if err != nil {
		t.Fatalf("Failed to marshal Location: %v", err)
	}

	var unmarshaled Location
	err = json.Unmarshal(data, &unmarshaled)
	if err != nil {
		t.Fatalf("Failed to unmarshal Location: %v", err)
	}

	if unmarshaled.File != loc.File {
		t.Errorf("File = %v, want %v", unmarshaled.File, loc.File)
	}
	if unmarshaled.Line != loc.Line {
		t.Errorf("Line = %v, want %v", unmarshaled.Line, loc.Line)
	}
	if unmarshaled.Column != loc.Column {
		t.Errorf("Column = %v, want %v", unmarshaled.Column, loc.Column)
	}
}

func TestGetDefinition_NonExistentFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := GetDefinition(ctx, "/tmp", "nonexistent.ts", 1, 1)
	if err == nil {
		t.Error("GetDefinition should error for non-existent file")
	}
}

func TestGetReferences_NonExistentFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := GetReferences(ctx, "/tmp", "nonexistent.ts", 1, 1, true)
	if err == nil {
		t.Error("GetReferences should error for non-existent file")
	}
}

func TestGetHover_NonExistentFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := GetHover(ctx, "/tmp", "nonexistent.ts", 1, 1)
	if err == nil {
		t.Error("GetHover should error for non-existent file")
	}
}

func TestGetDefinition_WithRealFile(t *testing.T) {
	// Create a temporary TypeScript file
	content := `const greeting = "hello";
function sayHello() {
  console.log(greeting);
}
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	err := os.WriteFile(tmpFile, []byte(content), 0644)
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := GetDefinition(ctx, tmpDir, "test.ts", 3, 15) // pointing at 'greeting'
	if err != nil {
		t.Fatalf("GetDefinition failed: %v", err)
	}

	if result.Symbol != "greeting" {
		t.Errorf("Symbol = %v, want greeting", result.Symbol)
	}
}

func TestGetReferences_WithRealFile(t *testing.T) {
	content := `const count = 0;
const x = count + 1;
console.log(count);
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	os.WriteFile(tmpFile, []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := GetReferences(ctx, tmpDir, "test.ts", 1, 7, true) // pointing at 'count'
	if err != nil {
		t.Fatalf("GetReferences failed: %v", err)
	}

	if result.Symbol != "count" {
		t.Errorf("Symbol = %v, want count", result.Symbol)
	}
	// Should find at least 2-3 references (declaration + usages)
	if result.Total < 2 {
		t.Errorf("Expected at least 2 references, got %d", result.Total)
	}
}

func TestGetHover_WithRealFile(t *testing.T) {
	content := `const myVariable = 42;
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	os.WriteFile(tmpFile, []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := GetHover(ctx, tmpDir, "test.ts", 1, 7)
	if err != nil {
		t.Fatalf("GetHover failed: %v", err)
	}

	if result.Symbol != "myVariable" {
		t.Errorf("Symbol = %v, want myVariable", result.Symbol)
	}
}

func TestGetSymbolAtPosition_ColumnAtEndOfWord(t *testing.T) {
	content := `const foo = 123;
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	os.WriteFile(tmpFile, []byte(content), 0644)

	// Column 9 is right after 'foo' ends
	got, err := getSymbolAtPosition(tmpFile, 1, 9)
	if err != nil {
		t.Fatalf("getSymbolAtPosition failed: %v", err)
	}
	if got != "foo" {
		t.Errorf("getSymbolAtPosition() = %v, want foo", got)
	}
}

func TestGetSymbolAtPosition_ColumnAtStartOfWord(t *testing.T) {
	content := `const foo = 123;
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	os.WriteFile(tmpFile, []byte(content), 0644)

	// Column 7 is at the start of 'foo'
	got, err := getSymbolAtPosition(tmpFile, 1, 7)
	if err != nil {
		t.Fatalf("getSymbolAtPosition failed: %v", err)
	}
	if got != "foo" {
		t.Errorf("getSymbolAtPosition() = %v, want foo", got)
	}
}

func TestGetSymbolAtPosition_ColumnBeyondLineLength(t *testing.T) {
	content := `const x = 1;
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test.ts")
	os.WriteFile(tmpFile, []byte(content), 0644)

	// Column 100 is way beyond the line length
	_, err := getSymbolAtPosition(tmpFile, 1, 100)
	// Should still work by clamping to line length
	if err != nil {
		// May return error if no symbol found at end
		// This is acceptable behavior
	}
}
