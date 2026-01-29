// internal/lsp/edge_cases_test.go
package lsp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestEdgeCases_VeryLongSymbolNames tests handling of very long symbol names
func TestEdgeCases_VeryLongSymbolNames(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a very long but valid identifier
	longName := strings.Repeat("a", 500)
	content := `const ` + longName + ` = 42;
`
	os.WriteFile(filepath.Join(tmpDir, "long_name.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search long name", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, longName[:50], false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find the long-named variable")
		}
	})

	t.Run("definition with long name", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "long_name.ts", 1, 10)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if len(result.Symbol) < 100 {
			t.Error("Should return the full long symbol name")
		}
	})
}

// TestEdgeCases_ManySymbolsOnOneLine tests handling of many symbols on a single line
func TestEdgeCases_ManySymbolsOnOneLine(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a line with many variable declarations
	vars := make([]string, 50)
	for i := 0; i < 50; i++ {
		vars[i] = "v" + string(rune('a'+i%26)) + string(rune('0'+i/26))
	}
	content := `const ` + strings.Join(vars, ` = 1, `) + ` = 1;
`
	os.WriteFile(filepath.Join(tmpDir, "many_vars.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find variable in crowded line", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "va0", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find variable in crowded line")
		}
	})
}

// TestEdgeCases_NestedBraces tests handling of deeply nested braces
func TestEdgeCases_NestedBraces(t *testing.T) {
	tmpDir := t.TempDir()

	// Create deeply nested object
	content := `const deepObject = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: {
                  level9: {
                    level10: {
                      value: 42
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};
`
	os.WriteFile(filepath.Join(tmpDir, "nested.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find deeply nested value", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "level10", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Should find deeply nested symbol")
		}
	})

	t.Run("definition at nesting level", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "nested.ts", 1, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "deepObject" {
			t.Errorf("Symbol = %v, want deepObject", result.Symbol)
		}
	})
}

// TestEdgeCases_MixedIndentation tests handling of mixed tabs and spaces
func TestEdgeCases_MixedIndentation(t *testing.T) {
	tmpDir := t.TempDir()

	// Create file with mixed indentation
	content := "function mixed() {\n" +
		"\tconst tabbed = 1;\n" +
		"    const spaced = 2;\n" +
		"\t  const mixed = 3;\n" +
		"  \tconst reverse = 4;\n" +
		"}\n"
	os.WriteFile(filepath.Join(tmpDir, "mixed.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		line int
		col  int
		want string
	}{
		{2, 8, "tabbed"},   // \tconst tabbed - 'tabbed' starts at col 8
		{3, 11, "spaced"},  // "    const spaced" - 'spaced' starts at col 11
		{4, 10, "mixed"},   // "\t  const mixed" - 'mixed' starts at col 10
		{5, 10, "reverse"}, // "  \tconst reverse" - 'reverse' starts at col 10
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "mixed.ts", tt.line, tt.col)
			if err != nil {
				t.Fatalf("GetDefinition failed: %v", err)
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestEdgeCases_OnlyComments tests files with only comments
func TestEdgeCases_OnlyComments(t *testing.T) {
	tmpDir := t.TempDir()

	content := `// This file only has comments
// No actual code here
/*
 * Multi-line comment
 * Also no code
 */
// More comments
`
	os.WriteFile(filepath.Join(tmpDir, "comments.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search in comment-only file", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "comment", false)
		if err != nil {
			t.Logf("Error (may be expected): %v", err)
		}
		// Should return result but may have no actual symbols
		if result != nil {
			t.Logf("Found %d matches", result.Total)
		}
	})
}

// TestEdgeCases_VerySmallFile tests single character file
func TestEdgeCases_VerySmallFile(t *testing.T) {
	tmpDir := t.TempDir()

	os.WriteFile(filepath.Join(tmpDir, "tiny.ts"), []byte("x"), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search in tiny file", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "x", false)
		if err != nil {
			t.Logf("Error (may be expected): %v", err)
		}
		if result != nil {
			t.Logf("Found %d matches", result.Total)
		}
	})
}

// TestEdgeCases_RepeatedSymbols tests many occurrences of the same symbol
func TestEdgeCases_RepeatedSymbols(t *testing.T) {
	tmpDir := t.TempDir()

	// Create file with many references to the same symbol
	lines := []string{"const shared = 1;"}
	for i := 0; i < 100; i++ {
		lines = append(lines, "const x"+string(rune('0'+i%10))+string(rune('0'+i/10%10))+" = shared;")
	}
	content := strings.Join(lines, "\n") + "\n"
	os.WriteFile(filepath.Join(tmpDir, "repeated.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("find highly referenced symbol", func(t *testing.T) {
		result, err := GetReferences(ctx, tmpDir, "repeated.ts", 1, 7, true)
		if err != nil {
			t.Fatalf("GetReferences failed: %v", err)
		}
		if result.Total < 50 {
			t.Errorf("Expected at least 50 references, got %d", result.Total)
		}
	})
}

// TestEdgeCases_SpecialFilenames tests files with special characters in names
func TestEdgeCases_SpecialFilenames(t *testing.T) {
	tmpDir := t.TempDir()

	specialNames := []string{
		"file-with-dashes.ts",
		"file_with_underscores.ts",
		"file.multiple.dots.ts",
		"UPPERCASE.TS",
		"MixedCase.Ts",
	}

	for _, name := range specialNames {
		content := `const from` + strings.ReplaceAll(strings.ReplaceAll(name, ".", ""), "-", "") + ` = 42;
`
		if err := os.WriteFile(filepath.Join(tmpDir, name), []byte(content), 0644); err != nil {
			continue // Skip if can't create
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, name := range specialNames {
		t.Run(name, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, name, 1, 7)
			if err != nil {
				t.Logf("Error for %s: %v", name, err)
				return
			}
			if result.Symbol == "" {
				t.Errorf("Should find symbol in %s", name)
			}
		})
	}
}

// TestEdgeCases_NumericOnlySearch tests searching for numeric strings
func TestEdgeCases_NumericOnlySearch(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const x = 12345;
const y = 67890;
const z = 12345;
`
	os.WriteFile(filepath.Join(tmpDir, "numbers.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search for number", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "12345", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		// Should find occurrences of the number
		t.Logf("Found %d matches for number", result.Total)
	})
}

// TestEdgeCases_RegexMetacharacters tests search with regex metacharacters
func TestEdgeCases_RegexMetacharacters(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const regex = /test.*pattern/;
const dollar = "$100";
const caret = "^start";
const plus = "1+1";
`
	os.WriteFile(filepath.Join(tmpDir, "regex.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// These shouldn't crash even if they look like regex
	searches := []string{".*", "$", "^", "+", "[", "("}

	for _, q := range searches {
		t.Run("search_"+q, func(t *testing.T) {
			result, err := SearchSymbols(ctx, tmpDir, q, false)
			// May error due to invalid regex, but shouldn't crash
			if err != nil {
				t.Logf("Error for '%s' (expected): %v", q, err)
			} else if result != nil {
				t.Logf("Found %d matches for '%s'", result.Total, q)
			}
		})
	}
}

// TestEdgeCases_NewlineVariations tests different newline styles
func TestEdgeCases_NewlineVariations(t *testing.T) {
	tmpDir := t.TempDir()

	// Unix style (LF)
	unixContent := "const unix = 1;\nconst unix2 = 2;\n"
	os.WriteFile(filepath.Join(tmpDir, "unix.ts"), []byte(unixContent), 0644)

	// Windows style (CRLF)
	windowsContent := "const windows = 1;\r\nconst windows2 = 2;\r\n"
	os.WriteFile(filepath.Join(tmpDir, "windows.ts"), []byte(windowsContent), 0644)

	// Old Mac style (CR)
	macContent := "const mac = 1;\rconst mac2 = 2;\r"
	os.WriteFile(filepath.Join(tmpDir, "mac.ts"), []byte(macContent), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		file string
		line int
		want string
	}{
		{"unix.ts", 1, "unix"},
		{"unix.ts", 2, "unix2"},
		{"windows.ts", 1, "windows"},
		{"windows.ts", 2, "windows2"},
	}

	for _, tt := range tests {
		t.Run(tt.file+"_line"+string(rune('0'+tt.line)), func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, tt.file, tt.line, 7)
			if err != nil {
				t.Logf("Error: %v", err)
				return
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestEdgeCases_TrailingWhitespace tests handling of trailing whitespace
func TestEdgeCases_TrailingWhitespace(t *testing.T) {
	tmpDir := t.TempDir()

	content := "const trailing = 1;   \n" +
		"const tabs = 2;\t\t\t\n" +
		"const mixed = 3; \t \t \n"
	os.WriteFile(filepath.Join(tmpDir, "trailing.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		line int
		want string
	}{
		{1, "trailing"},
		{2, "tabs"},
		{3, "mixed"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "trailing.ts", tt.line, 7)
			if err != nil {
				t.Fatalf("GetDefinition failed: %v", err)
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestEdgeCases_NoTrailingNewline tests files without trailing newline
func TestEdgeCases_NoTrailingNewline(t *testing.T) {
	tmpDir := t.TempDir()

	// No trailing newline
	content := "const noNewline = 42;"
	os.WriteFile(filepath.Join(tmpDir, "no_newline.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("definition in file without trailing newline", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "no_newline.ts", 1, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "noNewline" {
			t.Errorf("Symbol = %v, want noNewline", result.Symbol)
		}
	})
}

// TestEdgeCases_ConsecutiveDefinitions tests finding variables defined on consecutive lines
func TestEdgeCases_ConsecutiveDefinitions(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
`
	os.WriteFile(filepath.Join(tmpDir, "consecutive.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for line := 1; line <= 5; line++ {
		expected := string(rune('a' + line - 1))
		t.Run("line_"+string(rune('0'+line)), func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "consecutive.ts", line, 7)
			if err != nil {
				t.Fatalf("GetDefinition failed: %v", err)
			}
			if result.Symbol != expected {
				t.Errorf("Symbol = %v, want %v", result.Symbol, expected)
			}
		})
	}
}

// TestEdgeCases_MinimalValidCode tests the smallest possible valid code snippets
func TestEdgeCases_MinimalValidCode(t *testing.T) {
	tmpDir := t.TempDir()

	minimalCodes := map[string]string{
		"var.ts":      "let x;",
		"empty_fn.ts": "function f(){}",
		"arrow.ts":    "const f=()=>1;",
		"class.ts":    "class C{}",
		"iface.ts":    "interface I{}",
	}

	for name, code := range minimalCodes {
		os.WriteFile(filepath.Join(tmpDir, name), []byte(code), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		file string
		col  int
		want string
	}{
		{"var.ts", 5, "x"},
		{"empty_fn.ts", 10, "f"},
		{"arrow.ts", 7, "f"},
		{"class.ts", 7, "C"},
		{"iface.ts", 11, "I"},
	}

	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, tt.file, 1, tt.col)
			if err != nil {
				t.Logf("Error: %v", err)
				return
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestEdgeCases_KeywordsAsPartOfIdentifiers tests identifiers containing keywords
func TestEdgeCases_KeywordsAsPartOfIdentifiers(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const functionValue = 1;
const classData = 2;
const constable = 3;
const interfaceOptions = 4;
const letItBe = 5;
const ifCondition = 6;
const forEachItem = 7;
const whileTrue = 8;
`
	os.WriteFile(filepath.Join(tmpDir, "keywords.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		line int
		want string
	}{
		{1, "functionValue"},
		{2, "classData"},
		{3, "constable"},
		{4, "interfaceOptions"},
		{5, "letItBe"},
		{6, "ifCondition"},
		{7, "forEachItem"},
		{8, "whileTrue"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "keywords.ts", tt.line, 7)
			if err != nil {
				t.Fatalf("GetDefinition failed: %v", err)
			}
			if result.Symbol != tt.want {
				t.Errorf("Symbol = %v, want %v", result.Symbol, tt.want)
			}
		})
	}
}

// TestEdgeCases_SameNameDifferentScopes tests same symbol names in different scopes
func TestEdgeCases_SameNameDifferentScopes(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const value = 1;

function outer() {
  const value = 2;

  function inner() {
    const value = 3;
    return value;
  }

  return value;
}
`
	os.WriteFile(filepath.Join(tmpDir, "scopes.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search for 'value' finds all occurrences", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "value", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total < 3 {
			t.Errorf("Expected at least 3 occurrences, got %d", result.Total)
		}
	})
}

// TestEdgeCases_VeryLongLine tests handling of extremely long lines
func TestEdgeCases_VeryLongLine(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a line that's about 10000 characters long
	longString := strings.Repeat("x", 10000)
	content := `const veryLong = "` + longString + `";
const afterLong = 42;
`
	os.WriteFile(filepath.Join(tmpDir, "long_line.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("definition on very long line", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "long_line.ts", 1, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "veryLong" {
			t.Errorf("Symbol = %v, want veryLong", result.Symbol)
		}
	})

	t.Run("definition after very long line", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "long_line.ts", 2, 7)
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol != "afterLong" {
			t.Errorf("Symbol = %v, want afterLong", result.Symbol)
		}
	})
}

// TestEdgeCases_MultipleFilesWithSameContent tests files with identical content
func TestEdgeCases_MultipleFilesWithSameContent(t *testing.T) {
	tmpDir := t.TempDir()

	content := `export const sharedSymbol = 42;
`
	for i := 0; i < 5; i++ {
		os.WriteFile(filepath.Join(tmpDir, "duplicate"+string(rune('A'+i))+".ts"), []byte(content), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	t.Run("search finds symbol in all duplicate files", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "sharedSymbol", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total < 5 {
			t.Errorf("Expected at least 5 matches across duplicate files, got %d", result.Total)
		}
	})
}
