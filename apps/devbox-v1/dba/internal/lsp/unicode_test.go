// internal/lsp/unicode_test.go
package lsp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestUnicode_VariableNames tests handling of unicode variable names
func TestUnicode_VariableNames(t *testing.T) {
	tmpDir := t.TempDir()

	content := `// Unicode variable names (valid in modern JavaScript/TypeScript)
const café = "coffee";
const 日本語 = "Japanese";
const emoji = "🎉";
const π = 3.14159;
const Σ = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
`
	os.WriteFile(filepath.Join(tmpDir, "unicode.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Test that we can find ASCII variables in files with unicode
	t.Run("find ASCII in unicode file", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "emoji", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find 'emoji' variable")
		}
	})

	// Test searching for unicode variable (may not work with ripgrep)
	t.Run("search unicode variable", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "café", false)
		if err != nil {
			t.Logf("Unicode search error (may be expected): %v", err)
		}
		if result != nil {
			t.Logf("Found %d matches for 'café'", result.Total)
		}
	})
}

// TestUnicode_StringContents tests handling of unicode in string contents
func TestUnicode_StringContents(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const greeting = "Hello, 世界!";
const emoji = "🎉 Party time! 🎊";
const mixed = "ASCII and Ünîcödé";
const japanese = "こんにちは";
const arabic = "مرحبا";
const russian = "Привет";
`
	os.WriteFile(filepath.Join(tmpDir, "strings.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find variable with unicode string", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "greeting", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find 'greeting' variable")
		}
	})

	t.Run("get definition with unicode content", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "strings.ts", 1, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "greeting" {
			t.Errorf("Symbol = %v, want greeting", result.Symbol)
		}
	})
}

// TestUnicode_Comments tests handling of unicode in comments
func TestUnicode_Comments(t *testing.T) {
	tmpDir := t.TempDir()

	content := `// 这是一个中文注释
// Это комментарий на русском
// هذا تعليق عربي

/**
 * Documentación en español
 * Ümläuts and ñ characters
 */
const value = 42;
`
	os.WriteFile(filepath.Join(tmpDir, "comments.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find variable after unicode comments", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "comments.ts", 9, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "value" {
			t.Errorf("Symbol = %v, want value", result.Symbol)
		}
	})
}

// TestUnicode_FilePaths tests handling of unicode in file paths
func TestUnicode_FilePaths(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a directory with unicode name
	unicodeDir := filepath.Join(tmpDir, "模块")
	if err := os.MkdirAll(unicodeDir, 0755); err != nil {
		t.Skipf("Cannot create unicode directory: %v", err)
	}

	content := `export const value = 42;
`
	unicodeFile := filepath.Join(unicodeDir, "文件.ts")
	if err := os.WriteFile(unicodeFile, []byte(content), 0644); err != nil {
		t.Skipf("Cannot create unicode file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search in unicode path", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "value", false)
		if err != nil {
			t.Logf("Search error (may be expected): %v", err)
		}
		if result != nil {
			t.Logf("Found %d matches", result.Total)
		}
	})
}

// TestUnicode_LongLines tests handling of very long lines with unicode
func TestUnicode_LongLines(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file with a very long line
	longString := strings.Repeat("Hello 世界 ", 1000)
	content := `const longText = "` + longString + `";
const normalVar = 42;
`
	os.WriteFile(filepath.Join(tmpDir, "long.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find variable after long unicode line", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "long.ts", 2, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "normalVar" {
			t.Errorf("Symbol = %v, want normalVar", result.Symbol)
		}
	})
}

// TestSpecialChars_InCode tests handling of special characters in code
func TestSpecialChars_InCode(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const regex = /[a-z]+/g;
const path = "C:\\Users\\test";
const quote = 'It\'s a test';
const template = ` + "`Hello ${name}`" + `;
const special = "<>&\"'";
const backslash = "\\n\\t\\r";
`
	os.WriteFile(filepath.Join(tmpDir, "special.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		name string
		line int
		want string
	}{
		{"regex", 1, "regex"},
		{"path", 2, "path"},
		{"quote", 3, "quote"},
		{"template", 4, "template"},
		{"special", 5, "special"},
		{"backslash", 6, "backslash"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "special.ts", tt.line, 7)
			if err != nil {
				t.Fatalf("GetDefinition failed: %v", err)
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestSpecialChars_InIdentifiers tests handling of allowed special characters in identifiers
func TestSpecialChars_InIdentifiers(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const $dollar = 1;
const _underscore = 2;
const $_mixed = 3;
const __dunder__ = 4;
const UPPER_CASE = 5;
const camelCase = 6;
const PascalCase = 7;
const lower123 = 8;
`
	os.WriteFile(filepath.Join(tmpDir, "identifiers.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		line int
		col  int
		want string
	}{
		{1, 7, "$dollar"},
		{2, 7, "_underscore"},
		{3, 7, "$_mixed"},
		{4, 7, "__dunder__"},
		{5, 7, "UPPER_CASE"},
		{6, 7, "camelCase"},
		{7, 7, "PascalCase"},
		{8, 7, "lower123"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "identifiers.ts", tt.line, tt.col)
			if err != nil {
				t.Fatalf("GetDefinition failed for %s: %v", tt.want, err)
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestSpecialChars_Escapes tests handling of escape sequences
func TestSpecialChars_Escapes(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const newline = "\n";
const tab = "\t";
const carriage = "\r";
const backslash = "\\";
const unicode1 = "\u0041";  // A
const unicode2 = "\u{1F600}";  // 😀
`
	os.WriteFile(filepath.Join(tmpDir, "escapes.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Just verify we can read the file and find symbols
	result, err := SearchSymbols(ctx, tmpDir, "newline", false)
	if err != nil {
		t.Fatalf("SearchSymbols failed: %v", err)
	}
	if result.Total == 0 {
		t.Error("Should find 'newline' variable")
	}
}

// TestSpecialChars_JSONContent tests handling of JSON-like content
func TestSpecialChars_JSONContent(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const config = {
  "key": "value",
  "nested": {
    "array": [1, 2, 3],
    "boolean": true,
    "null": null
  },
  "special": "quotes: \" and backslash: \\"
};
`
	os.WriteFile(filepath.Join(tmpDir, "json.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find config variable", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "json.ts", 1, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "config" {
			t.Errorf("Symbol = %v, want config", result.Symbol)
		}
	})
}

// TestSpecialChars_WhitespaceVariations tests handling of different whitespace
func TestSpecialChars_WhitespaceVariations(t *testing.T) {
	tmpDir := t.TempDir()

	// Create file with various whitespace (tabs, multiple spaces, etc.)
	content := "const	tabbed = 1;\n" + // tab
		"const  double_space = 2;\n" +
		"const\t\tmulti_tab = 3;\n" +
		"const normal = 4;\n"
	os.WriteFile(filepath.Join(tmpDir, "whitespace.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find variable with tab indentation", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "tabbed", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find 'tabbed' variable")
		}
	})
}

// TestSpecialChars_BOM tests handling of files with BOM (Byte Order Mark)
func TestSpecialChars_BOM(t *testing.T) {
	tmpDir := t.TempDir()

	// Create file with UTF-8 BOM
	bom := []byte{0xEF, 0xBB, 0xBF}
	content := append(bom, []byte("const withBOM = 42;\n")...)
	os.WriteFile(filepath.Join(tmpDir, "bom.ts"), content, 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find variable in file with BOM", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "withBOM", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find 'withBOM' variable")
		}
	})
}

// TestSpecialChars_EmptyLines tests handling of empty lines and whitespace-only lines
func TestSpecialChars_EmptyLines(t *testing.T) {
	tmpDir := t.TempDir()

	content := `

const after_empty = 1;


const after_whitespace = 2;

const normal = 3;
`
	os.WriteFile(filepath.Join(tmpDir, "empty_lines.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		line int
		want string
	}{
		{3, "after_empty"},
		{6, "after_whitespace"},
		{8, "normal"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "empty_lines.ts", tt.line, 7)
			if err != nil {
				t.Fatalf("GetDefinition failed: %v", err)
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}
