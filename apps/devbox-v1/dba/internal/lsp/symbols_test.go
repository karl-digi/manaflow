// internal/lsp/symbols_test.go
package lsp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDetectSymbolKind(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "function declaration",
			content: "function handleSubmit() {",
			want:    "function",
		},
		{
			name:    "arrow function",
			content: "const handleSubmit = () => {",
			want:    "constant", // const takes precedence
		},
		{
			name:    "class declaration",
			content: "class UserService {",
			want:    "class",
		},
		{
			name:    "interface declaration",
			content: "interface User {",
			want:    "interface",
		},
		{
			name:    "type declaration",
			content: "type UserProps = {",
			want:    "type",
		},
		{
			name:    "const declaration",
			content: "const API_URL = 'https://api.example.com'",
			want:    "constant",
		},
		{
			name:    "let declaration",
			content: "let count = 0",
			want:    "variable",
		},
		{
			name:    "var declaration",
			content: "var oldStyle = true",
			want:    "variable",
		},
		{
			name:    "export declaration",
			content: "export default App",
			want:    "export",
		},
		{
			name:    "export function",
			content: "export function main() {",
			want:    "function", // function takes precedence over export
		},
		{
			name:    "unknown",
			content: "console.log('hello')",
			want:    "unknown",
		},
		{
			name:    "empty content",
			content: "",
			want:    "unknown",
		},
		{
			name:    "case insensitive - FUNCTION",
			content: "FUNCTION test() {",
			want:    "function",
		},
		{
			name:    "case insensitive - Class",
			content: "Class MyClass {",
			want:    "class",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectSymbolKind(tt.content)
			if got != tt.want {
				t.Errorf("detectSymbolKind(%q) = %v, want %v", tt.content, got, tt.want)
			}
		})
	}
}

func TestSymbolSearchResult_TextOutput(t *testing.T) {
	tests := []struct {
		name     string
		result   *SymbolSearchResult
		contains []string
	}{
		{
			name: "with symbols",
			result: &SymbolSearchResult{
				Query: "handleSubmit",
				Symbols: []Symbol{
					{Name: "handleSubmit", Kind: "function", File: "src/form.tsx", Line: 15, Content: "function handleSubmit() {"},
					{Name: "handleSubmit", Kind: "function", File: "src/login.tsx", Line: 42, Content: "const handleSubmit = async () => {"},
				},
				Total: 2,
			},
			contains: []string{"handleSubmit", "function", "src/form.tsx:15", "src/login.tsx:42", "Found 2 symbols"},
		},
		{
			name: "no symbols",
			result: &SymbolSearchResult{
				Query:   "nonexistent",
				Symbols: []Symbol{},
				Total:   0,
			},
			contains: []string{"No symbols found", "nonexistent"},
		},
		{
			name: "symbol without content",
			result: &SymbolSearchResult{
				Query: "test",
				Symbols: []Symbol{
					{Name: "test", Kind: "function", File: "test.ts", Line: 1, Content: ""},
				},
				Total: 1,
			},
			contains: []string{"test", "function", "test.ts:1"},
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

func TestRipgrepMessage_Parsing(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{
			name:    "valid match message",
			json:    `{"type":"match","data":{"path":{"text":"src/app.tsx"},"lines":{"text":"function test()"},"line_number":10}}`,
			wantErr: false,
		},
		{
			name:    "begin message",
			json:    `{"type":"begin","data":{"path":{"text":"src/app.tsx"}}}`,
			wantErr: false,
		},
		{
			name:    "end message",
			json:    `{"type":"end","data":{"path":{"text":"src/app.tsx"}}}`,
			wantErr: false,
		},
		{
			name:    "summary message",
			json:    `{"type":"summary","data":{}}`,
			wantErr: false,
		},
		{
			name:    "invalid json",
			json:    `{invalid`,
			wantErr: true,
		},
		{
			name:    "empty json",
			json:    `{}`,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg RipgrepMessage
			err := json.Unmarshal([]byte(tt.json), &msg)
			if (err != nil) != tt.wantErr {
				t.Errorf("json.Unmarshal() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRipgrepMessage_MatchExtraction(t *testing.T) {
	jsonStr := `{"type":"match","data":{"path":{"text":"src/utils.ts"},"lines":{"text":"export function formatDate(date: Date) {"},"line_number":25}}`

	var msg RipgrepMessage
	err := json.Unmarshal([]byte(jsonStr), &msg)
	if err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if msg.Type != "match" {
		t.Errorf("Type = %v, want match", msg.Type)
	}
	if msg.Data == nil {
		t.Fatal("Data should not be nil")
	}
	if msg.Data.Path == nil || msg.Data.Path.Text != "src/utils.ts" {
		t.Errorf("Path.Text = %v, want src/utils.ts", msg.Data.Path)
	}
	if msg.Data.Lines == nil || !strings.Contains(msg.Data.Lines.Text, "formatDate") {
		t.Errorf("Lines.Text should contain formatDate")
	}
	if msg.Data.LineNumber != 25 {
		t.Errorf("LineNumber = %v, want 25", msg.Data.LineNumber)
	}
}

func TestSearchSymbols_NonExistentPath(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := SearchSymbols(ctx, "/nonexistent/path", "test", false)
	// Should not error, just return empty results
	if err != nil {
		t.Errorf("SearchSymbols should not error for non-existent path: %v", err)
	}
	if result == nil {
		t.Error("SearchSymbols should return a result")
	}
	if result.Query != "test" {
		t.Errorf("Query = %v, want test", result.Query)
	}
}

func TestSearchSymbols_EmptyQuery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := SearchSymbols(ctx, "/tmp", "", false)
	if err != nil {
		t.Errorf("SearchSymbols should handle empty query: %v", err)
	}
	if result == nil {
		t.Error("SearchSymbols should return a result even for empty query")
	}
}

func TestSearchSymbols_SymbolsOnlyPattern(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Test that symbolsOnly=true uses a different pattern
	result1, _ := SearchSymbols(ctx, "/tmp", "test", false)
	result2, _ := SearchSymbols(ctx, "/tmp", "test", true)

	// Both should return results (empty in this case)
	if result1 == nil || result2 == nil {
		t.Error("SearchSymbols should always return a result")
	}
}

func TestSymbol_Fields(t *testing.T) {
	sym := Symbol{
		Name:    "handleClick",
		Kind:    "function",
		File:    "src/components/Button.tsx",
		Line:    42,
		Column:  3,
		Content: "const handleClick = () => {",
	}

	// Test JSON marshaling
	data, err := json.Marshal(sym)
	if err != nil {
		t.Fatalf("Failed to marshal Symbol: %v", err)
	}

	var unmarshaled Symbol
	err = json.Unmarshal(data, &unmarshaled)
	if err != nil {
		t.Fatalf("Failed to unmarshal Symbol: %v", err)
	}

	if unmarshaled.Name != sym.Name {
		t.Errorf("Name = %v, want %v", unmarshaled.Name, sym.Name)
	}
	if unmarshaled.Kind != sym.Kind {
		t.Errorf("Kind = %v, want %v", unmarshaled.Kind, sym.Kind)
	}
	if unmarshaled.File != sym.File {
		t.Errorf("File = %v, want %v", unmarshaled.File, sym.File)
	}
	if unmarshaled.Line != sym.Line {
		t.Errorf("Line = %v, want %v", unmarshaled.Line, sym.Line)
	}
}

func TestSymbol_JSONOmitEmpty(t *testing.T) {
	sym := Symbol{
		Name: "test",
		Kind: "function",
		File: "test.ts",
		Line: 1,
		// Content is empty
	}

	data, err := json.Marshal(sym)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	// Content should be omitted when empty
	if strings.Contains(string(data), `"content":""`) {
		t.Error("Empty content should be omitted from JSON")
	}
}
