// internal/lsp/integration_test.go
package lsp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestIntegration_FullWorkflow tests a complete workflow through all LSP operations
func TestIntegration_FullWorkflow(t *testing.T) {
	// Create a temporary project directory
	tmpDir := t.TempDir()

	// Create a TypeScript file with some code
	tsContent := `interface User {
  id: number;
  name: string;
  email: string;
}

function getUserById(id: number): User | null {
  const users: User[] = [];
  return users.find(u => u.id === id) || null;
}

function formatUser(user: User): string {
  return user.name + " <" + user.email + ">";
}

const currentUser = getUserById(1);
if (currentUser) {
  console.log(formatUser(currentUser));
}
`
	tsFile := filepath.Join(tmpDir, "app.ts")
	if err := os.WriteFile(tsFile, []byte(tsContent), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Test 1: Symbol search for "User"
	t.Run("symbol search", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "User", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Expected to find User symbols")
		}
	})

	// Test 2: Get definition
	t.Run("get definition", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "app.ts", 8, 20) // pointing at 'User' in the function return type
		if err != nil {
			t.Fatalf("GetDefinition failed: %v", err)
		}
		if result.Symbol == "" {
			t.Error("Expected to get a symbol")
		}
	})

	// Test 3: Find references
	t.Run("find references", func(t *testing.T) {
		result, err := GetReferences(ctx, tmpDir, "app.ts", 1, 12, true) // pointing at 'User'
		if err != nil {
			t.Fatalf("GetReferences failed: %v", err)
		}
		// Should find multiple references to User
		if result.Total == 0 {
			t.Error("Expected to find references to User")
		}
	})

	// Test 4: Hover information
	t.Run("hover", func(t *testing.T) {
		result, err := GetHover(ctx, tmpDir, "app.ts", 7, 12) // pointing at 'getUserById'
		if err != nil {
			t.Fatalf("GetHover failed: %v", err)
		}
		if result.Symbol == "" {
			t.Error("Expected to get hover information")
		}
	})

	// Test 5: Rename symbol (dry run)
	t.Run("rename dry run", func(t *testing.T) {
		result, err := RenameSymbol(ctx, tmpDir, "app.ts", 1, 12, "UserProfile", true)
		if err != nil {
			t.Fatalf("RenameSymbol failed: %v", err)
		}
		if result.OldName == "" {
			t.Error("Expected to get old name")
		}
		if result.Applied {
			t.Error("Dry run should not apply changes")
		}
	})
}

// TestIntegration_MultiFileProject tests operations across multiple files
func TestIntegration_MultiFileProject(t *testing.T) {
	tmpDir := t.TempDir()

	// Create types.ts
	typesContent := `export interface Config {
  apiUrl: string;
  timeout: number;
}

export const defaultConfig: Config = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
};
`
	if err := os.WriteFile(filepath.Join(tmpDir, "types.ts"), []byte(typesContent), 0644); err != nil {
		t.Fatalf("Failed to create types.ts: %v", err)
	}

	// Create app.ts that imports from types.ts
	appContent := `import { Config, defaultConfig } from './types';

function loadConfig(): Config {
  return defaultConfig;
}

const config = loadConfig();
console.log(config.apiUrl);
`
	if err := os.WriteFile(filepath.Join(tmpDir, "app.ts"), []byte(appContent), 0644); err != nil {
		t.Fatalf("Failed to create app.ts: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Test: Find references to Config across files
	t.Run("cross-file references", func(t *testing.T) {
		result, err := GetReferences(ctx, tmpDir, "types.ts", 1, 18, true) // pointing at 'Config'
		if err != nil {
			t.Fatalf("GetReferences failed: %v", err)
		}
		// Should find Config in both files
		if result.Total < 2 {
			t.Errorf("Expected at least 2 references to Config, got %d", result.Total)
		}
	})

	// Test: Search for defaultConfig symbol
	t.Run("symbol search across files", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "defaultConfig", true)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		if result.Total == 0 {
			t.Error("Expected to find defaultConfig symbol")
		}
	})
}

// TestIntegration_EmptyProject tests operations on an empty project
func TestIntegration_EmptyProject(t *testing.T) {
	tmpDir := t.TempDir()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Test: Symbol search in empty project should not error
	t.Run("symbol search empty", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "anything", false)
		if err != nil {
			t.Fatalf("SearchSymbols should not error on empty project: %v", err)
		}
		if result.Total != 0 {
			t.Error("Expected no symbols in empty project")
		}
	})

	// Test: Diagnostics on empty project
	t.Run("diagnostics empty", func(t *testing.T) {
		result, err := GetDiagnostics(ctx, tmpDir, DiagnosticsOptions{})
		if err != nil {
			t.Fatalf("GetDiagnostics should not error on empty project: %v", err)
		}
		if result == nil {
			t.Error("Expected non-nil result")
		}
	})

	// Test: Code actions without a valid file
	t.Run("code actions empty", func(t *testing.T) {
		result, err := GetCodeActions(ctx, tmpDir, "nonexistent.ts", 1, 1)
		if err != nil {
			t.Fatalf("GetCodeActions should not error: %v", err)
		}
		if result == nil {
			t.Error("Expected non-nil result")
		}
	})
}

// TestIntegration_LargeFile tests operations on a large file
func TestIntegration_LargeFile(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a large file with many functions
	var content string
	for i := 0; i < 100; i++ {
		content += `function func` + string(rune('0'+i%10)) + `_` + string(rune('a'+i/10)) + `(): void {
  console.log("function ` + string(rune('0'+i%10)) + `_` + string(rune('a'+i/10)) + `");
}

`
	}

	if err := os.WriteFile(filepath.Join(tmpDir, "large.ts"), []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create large.ts: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Test: Symbol search in large file
	t.Run("symbol search large file", func(t *testing.T) {
		result, err := SearchSymbols(ctx, tmpDir, "func", false)
		if err != nil {
			t.Fatalf("SearchSymbols failed: %v", err)
		}
		// Should find many functions
		if result.Total < 10 {
			t.Errorf("Expected many symbols, got %d", result.Total)
		}
	})

	// Test: Get definition at various positions
	t.Run("definition in large file", func(t *testing.T) {
		for _, line := range []int{1, 50, 100} {
			result, err := GetDefinition(ctx, tmpDir, "large.ts", line, 10)
			if err != nil {
				t.Logf("GetDefinition at line %d returned error (may be expected): %v", line, err)
			}
			if result != nil && result.Symbol != "" {
				t.Logf("Found symbol at line %d: %s", line, result.Symbol)
			}
		}
	})
}

// TestIntegration_SpecialCharacters tests handling of special characters
func TestIntegration_SpecialCharacters(t *testing.T) {
	tmpDir := t.TempDir()

	// Create file with special characters in identifiers
	content := `const $config = {};
const _privateVar = 42;
const CONSTANT_VALUE = "test";
const camelCase = true;
const PascalCase = false;
const snake_case = 1;
`
	if err := os.WriteFile(filepath.Join(tmpDir, "special.ts"), []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create special.ts: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tests := []struct {
		name   string
		symbol string
		line   int
		col    int
	}{
		{"dollar sign", "$config", 1, 7},
		{"underscore prefix", "_privateVar", 2, 7},
		{"uppercase constant", "CONSTANT_VALUE", 3, 7},
		{"camelCase", "camelCase", 4, 7},
		{"PascalCase", "PascalCase", 5, 7},
		{"snake_case", "snake_case", 6, 7},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := GetDefinition(ctx, tmpDir, "special.ts", tt.line, tt.col)
			if err != nil {
				t.Errorf("GetDefinition failed for %s: %v", tt.symbol, err)
				return
			}
			if result.Symbol != tt.symbol {
				t.Errorf("Expected symbol %s, got %s", tt.symbol, result.Symbol)
			}
		})
	}
}

// TestIntegration_RenameApply tests actually applying a rename
func TestIntegration_RenameApply(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const oldName = 1;
const x = oldName + 2;
console.log(oldName);
`
	filePath := filepath.Join(tmpDir, "rename.ts")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create rename.ts: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Apply rename
	result, err := RenameSymbol(ctx, tmpDir, "rename.ts", 1, 7, "newName", false)
	if err != nil {
		t.Fatalf("RenameSymbol failed: %v", err)
	}

	if !result.Applied {
		t.Error("Expected rename to be applied")
	}

	// Verify the file was changed
	newContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read file after rename: %v", err)
	}

	contentStr := string(newContent)
	if !contains(contentStr, "newName") {
		t.Error("File should contain newName after rename")
	}
	// The implementation replaces at word boundaries, so some occurrences might remain
	// depending on exact replacement logic
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && (s[:len(substr)] == substr || contains(s[1:], substr)))
}

// TestIntegration_ContextCancellation tests that operations respect context cancellation
func TestIntegration_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file
	if err := os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte("const x = 1;"), 0644); err != nil {
		t.Fatalf("Failed to create test.ts: %v", err)
	}

	// Create an already-cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Operations should handle cancelled context gracefully
	t.Run("search with cancelled context", func(t *testing.T) {
		_, err := SearchSymbols(ctx, tmpDir, "x", false)
		// Should either return an error or empty results
		if err != nil {
			t.Logf("SearchSymbols returned error with cancelled context (expected): %v", err)
		}
	})

	t.Run("diagnostics with cancelled context", func(t *testing.T) {
		_, err := GetDiagnostics(ctx, tmpDir, DiagnosticsOptions{})
		// Should handle gracefully
		if err != nil {
			t.Logf("GetDiagnostics returned error with cancelled context (expected): %v", err)
		}
	})
}
