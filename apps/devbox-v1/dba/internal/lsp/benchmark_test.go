// internal/lsp/benchmark_test.go
package lsp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// BenchmarkSearchSymbols benchmarks symbol search performance
func BenchmarkSearchSymbols(b *testing.B) {
	tmpDir := b.TempDir()

	// Create test files
	for i := 0; i < 10; i++ {
		content := generateTestFile(i)
		filename := filepath.Join(tmpDir, "file"+string(rune('A'+i))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		SearchSymbols(ctx, tmpDir, "function", false)
	}
}

// BenchmarkSearchSymbols_SymbolsOnly benchmarks symbol-only search
func BenchmarkSearchSymbols_SymbolsOnly(b *testing.B) {
	tmpDir := b.TempDir()

	for i := 0; i < 10; i++ {
		content := generateTestFile(i)
		filename := filepath.Join(tmpDir, "file"+string(rune('A'+i))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		SearchSymbols(ctx, tmpDir, "myFunc", true)
	}
}

// BenchmarkGetDefinition benchmarks definition lookup
func BenchmarkGetDefinition(b *testing.B) {
	tmpDir := b.TempDir()

	content := `const foo = 1;
const bar = foo + 2;
const baz = bar + foo;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GetDefinition(ctx, tmpDir, "test.ts", 2, 13)
	}
}

// BenchmarkGetReferences benchmarks reference lookup
func BenchmarkGetReferences(b *testing.B) {
	tmpDir := b.TempDir()

	content := `const shared = 1;
const a = shared;
const b = shared;
const c = shared;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GetReferences(ctx, tmpDir, "test.ts", 1, 7, true)
	}
}

// BenchmarkGetHover benchmarks hover lookup
func BenchmarkGetHover(b *testing.B) {
	tmpDir := b.TempDir()

	content := `const myVariable = 42;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GetHover(ctx, tmpDir, "test.ts", 1, 7)
	}
}

// BenchmarkGetDiagnostics benchmarks diagnostics retrieval
func BenchmarkGetDiagnostics(b *testing.B) {
	tmpDir := b.TempDir()

	content := `const x = 1;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GetDiagnostics(ctx, tmpDir, DiagnosticsOptions{})
	}
}

// BenchmarkGetCodeActions benchmarks code actions retrieval
func BenchmarkGetCodeActions(b *testing.B) {
	tmpDir := b.TempDir()

	content := `const x = 1;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GetCodeActions(ctx, tmpDir, "test.ts", 1, 1)
	}
}

// BenchmarkRenameSymbol_DryRun benchmarks rename dry run
func BenchmarkRenameSymbol_DryRun(b *testing.B) {
	tmpDir := b.TempDir()

	content := `const oldName = 1;
const x = oldName;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		RenameSymbol(ctx, tmpDir, "test.ts", 1, 7, "newName", true)
	}
}

// BenchmarkParseLocation benchmarks location parsing
func BenchmarkParseLocation(b *testing.B) {
	for i := 0; i < b.N; i++ {
		ParseLocation("src/app.tsx:42:10")
	}
}

// BenchmarkFormatLocation benchmarks location formatting
func BenchmarkFormatLocation(b *testing.B) {
	for i := 0; i < b.N; i++ {
		FormatLocation("src/app.tsx", 42, 10)
	}
}

// BenchmarkParseTypeScriptOutput benchmarks TypeScript output parsing
func BenchmarkParseTypeScriptOutput(b *testing.B) {
	output := `src/app.tsx(42,10): error TS2551: Property 'emial' does not exist. Did you mean 'email'?
src/utils.ts(10,5): error TS2304: Cannot find name 'foo'.
src/types.ts(5,1): warning TS6133: 'x' is declared but never used.
`
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseTypeScriptOutput(output, "/project")
	}
}

// BenchmarkParseESLintOutput benchmarks ESLint output parsing
func BenchmarkParseESLintOutput(b *testing.B) {
	output := []byte(`[
		{"filePath": "/project/src/a.tsx", "messages": [{"line": 1, "column": 1, "severity": 2, "message": "Error", "ruleId": "rule-1"}]},
		{"filePath": "/project/src/b.tsx", "messages": [{"line": 2, "column": 2, "severity": 1, "message": "Warning", "ruleId": "rule-2"}]}
	]`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseESLintOutput(output, "/project")
	}
}

// BenchmarkReplaceWord benchmarks word replacement
func BenchmarkReplaceWord(b *testing.B) {
	content := `const foo = 1;
const bar = foo;
function useFoo() { return foo; }
const baz = foo + foo;
`
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		replaceWord(content, "foo", "bar")
	}
}

// BenchmarkDetectSymbolKind benchmarks symbol kind detection
func BenchmarkDetectSymbolKind(b *testing.B) {
	contents := []string{
		"function myFunction() {",
		"class MyClass {",
		"const myConst = 1;",
		"interface MyInterface {",
		"type MyType = string;",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		detectSymbolKind(contents[i%len(contents)])
	}
}

// BenchmarkFilterDiagnostics benchmarks diagnostic filtering
func BenchmarkFilterDiagnostics(b *testing.B) {
	diags := make([]Diagnostic, 100)
	for i := 0; i < 100; i++ {
		diags[i] = Diagnostic{
			File:     "file" + string(rune('A'+i%26)) + ".ts",
			Severity: []string{"error", "warning", "info", "hint"}[i%4],
			Source:   []string{"typescript", "eslint"}[i%2],
		}
	}
	opts := DiagnosticsOptions{
		File:     "fileA.ts",
		Severity: "error",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		filterDiagnostics(diags, opts)
	}
}

// BenchmarkTextOutput benchmarks text output generation
func BenchmarkTextOutput_Diagnostics(b *testing.B) {
	result := &DiagnosticsResult{
		Diagnostics: make([]Diagnostic, 50),
	}
	for i := 0; i < 50; i++ {
		result.Diagnostics[i] = Diagnostic{
			File:     "file.ts",
			Line:     i + 1,
			Column:   1,
			Severity: "error",
			Message:  "Test error message",
			Code:     "TS2551",
			Source:   "typescript",
		}
	}
	result.Summary.Errors = 50
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result.TextOutput()
	}
}

// BenchmarkLargeProject simulates a large project search
func BenchmarkLargeProject(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping large project benchmark in short mode")
	}

	tmpDir := b.TempDir()

	// Create 100 files
	for i := 0; i < 100; i++ {
		content := generateTestFile(i)
		filename := filepath.Join(tmpDir, "module"+string(rune('A'+i/26))+string(rune('a'+i%26))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		SearchSymbols(ctx, tmpDir, "myFunc", false)
	}
}

// Helper function to generate test file content
func generateTestFile(idx int) string {
	return `// File ` + string(rune('A'+idx)) + `
export interface Model` + string(rune('A'+idx)) + ` {
  id: number;
  name: string;
}

export function myFunc` + string(rune('A'+idx)) + `(): void {
  console.log("function ` + string(rune('A'+idx)) + `");
}

export const instance` + string(rune('A'+idx)) + ` = {
  id: ` + string(rune('0'+idx%10)) + `,
  name: "test"
};
`
}

// TestDeepNesting tests deeply nested directory structures
func TestDeepNesting_DirectoryStructure(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a deeply nested directory structure
	deepPath := tmpDir
	for i := 0; i < 20; i++ {
		deepPath = filepath.Join(deepPath, "level"+string(rune('0'+i%10)))
	}
	if err := os.MkdirAll(deepPath, 0755); err != nil {
		t.Fatalf("Failed to create deep directory: %v", err)
	}

	// Create a file at the deepest level
	content := `export const deepValue = 42;
`
	os.WriteFile(filepath.Join(deepPath, "deep.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Run("search in deep directory", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "deepValue", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find 'deepValue' in deep directory")
		}
	})
}

// TestDeepNesting_ManyFiles tests directories with many files
func TestDeepNesting_ManyFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping many files test in short mode")
	}

	tmpDir := t.TempDir()

	// Create 200 files in the same directory
	for i := 0; i < 200; i++ {
		content := `export const value` + string(rune('A'+i/26)) + string(rune('a'+i%26)) + ` = ` + string(rune('0'+i%10)) + `;
`
		filename := filepath.Join(tmpDir, "file"+string(rune('A'+i/26))+string(rune('a'+i%26))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Run("search in many files", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "value", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		// Should find at least some matches
		if result.Total < 50 {
			t.Errorf("Expected many matches, got %d", result.Total)
		}
	})
}

// TestDeepNesting_LongFilenames tests handling of long filenames
func TestDeepNesting_LongFilenames(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file with a very long name (but within filesystem limits)
	longName := ""
	for i := 0; i < 50; i++ {
		longName += "a"
	}
	longName += ".ts"

	content := `export const longFileName = 42;
`
	if err := os.WriteFile(filepath.Join(tmpDir, longName), []byte(content), 0644); err != nil {
		t.Skipf("Cannot create long filename: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search with long filename", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "longFileName", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find 'longFileName'")
		}
	})
}

// TestDeepNesting_Symlinks tests handling of symlinked directories
func TestDeepNesting_Symlinks(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a subdirectory with a file
	subDir := filepath.Join(tmpDir, "sub")
	os.MkdirAll(subDir, 0755)

	content := `export const symlinked = 42;
`
	os.WriteFile(filepath.Join(subDir, "file.ts"), []byte(content), 0644)

	// Create a symlink to the subdirectory
	linkDir := filepath.Join(tmpDir, "link")
	if err := os.Symlink(subDir, linkDir); err != nil {
		t.Skipf("Cannot create symlink: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search through symlink", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "symlinked", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		// May find it once or twice (through real path and symlink)
		if result.Total == 0 {
			t.Error("Should find 'symlinked'")
		}
	})
}
