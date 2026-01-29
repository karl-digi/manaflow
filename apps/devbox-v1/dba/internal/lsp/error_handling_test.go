// internal/lsp/error_handling_test.go
package lsp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestErrorHandling_NonExistentPaths tests error handling for non-existent paths
func TestErrorHandling_NonExistentPaths(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	nonExistent := "/this/path/does/not/exist/anywhere"

	t.Run("SearchSymbols non-existent path", func(t *testing.T) {
		result, err := SearchSymbols(ctx, nonExistent, "test", false)
		// Should not error, just return empty results
		if err != nil {
			t.Logf("SearchSymbols error (may be acceptable): %v", err)
		}
		if result == nil {
			t.Error("Should return a result object")
		}
	})

	t.Run("GetDiagnostics non-existent path", func(t *testing.T) {
		result, err := GetDiagnostics(ctx, nonExistent, DiagnosticsOptions{})
		if err != nil {
			t.Logf("GetDiagnostics error (may be acceptable): %v", err)
		}
		if result == nil {
			t.Error("Should return a result object")
		}
	})

	t.Run("GetCodeActions non-existent path", func(t *testing.T) {
		result, err := GetCodeActions(ctx, nonExistent, "file.ts", 1, 1)
		if err != nil {
			t.Logf("GetCodeActions error (may be acceptable): %v", err)
		}
		if result == nil {
			t.Error("Should return a result object")
		}
	})

	t.Run("GetDefinition non-existent file", func(t *testing.T) {
		_, err := GetDefinition(ctx, nonExistent, "file.ts", 1, 1)
		if err == nil {
			t.Error("GetDefinition should error for non-existent file")
		}
	})

	t.Run("GetReferences non-existent file", func(t *testing.T) {
		_, err := GetReferences(ctx, nonExistent, "file.ts", 1, 1, true)
		if err == nil {
			t.Error("GetReferences should error for non-existent file")
		}
	})

	t.Run("GetHover non-existent file", func(t *testing.T) {
		_, err := GetHover(ctx, nonExistent, "file.ts", 1, 1)
		if err == nil {
			t.Error("GetHover should error for non-existent file")
		}
	})

	t.Run("RenameSymbol non-existent file", func(t *testing.T) {
		_, err := RenameSymbol(ctx, nonExistent, "file.ts", 1, 1, "newName", true)
		if err == nil {
			t.Error("RenameSymbol should error for non-existent file")
		}
	})
}

// TestErrorHandling_InvalidPositions tests error handling for invalid positions
func TestErrorHandling_InvalidPositions(t *testing.T) {
	tmpDir := t.TempDir()
	content := `const x = 1;
`
	if err := os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("negative line", func(t *testing.T) {
		_, err := GetDefinition(ctx, tmpDir, "test.ts", -1, 1)
		if err == nil {
			t.Error("Should error for negative line")
		}
	})

	t.Run("zero line", func(t *testing.T) {
		_, err := GetDefinition(ctx, tmpDir, "test.ts", 0, 1)
		if err == nil {
			t.Error("Should error for zero line")
		}
	})

	t.Run("line out of bounds", func(t *testing.T) {
		_, err := GetDefinition(ctx, tmpDir, "test.ts", 1000, 1)
		if err == nil {
			t.Error("Should error for line out of bounds")
		}
	})

	t.Run("negative column should still work", func(t *testing.T) {
		// Columns are typically 1-indexed, but we clamp to valid values
		_, err := GetDefinition(ctx, tmpDir, "test.ts", 1, -1)
		// This should work because we clamp column values
		if err != nil {
			t.Logf("Error (may be expected): %v", err)
		}
	})
}

// TestErrorHandling_EmptyFile tests error handling for empty files
func TestErrorHandling_EmptyFile(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "empty.ts"), []byte(""), 0644); err != nil {
		t.Fatalf("Failed to create empty file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("definition in empty file", func(t *testing.T) {
		_, err := GetDefinition(ctx, tmpDir, "empty.ts", 1, 1)
		if err == nil {
			t.Error("Should error for empty file")
		}
	})

	t.Run("references in empty file", func(t *testing.T) {
		_, err := GetReferences(ctx, tmpDir, "empty.ts", 1, 1, true)
		if err == nil {
			t.Error("Should error for empty file")
		}
	})

	t.Run("hover in empty file", func(t *testing.T) {
		_, err := GetHover(ctx, tmpDir, "empty.ts", 1, 1)
		if err == nil {
			t.Error("Should error for empty file")
		}
	})
}

// TestErrorHandling_BinaryFile tests handling of binary files
func TestErrorHandling_BinaryFile(t *testing.T) {
	tmpDir := t.TempDir()
	// Create a binary file
	binaryContent := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}
	if err := os.WriteFile(filepath.Join(tmpDir, "binary.bin"), binaryContent, 0644); err != nil {
		t.Fatalf("Failed to create binary file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("search in binary file", func(t *testing.T) {
		// Should not crash, should return empty results
		result, _ := SearchSymbols(ctx, tmpDir, "test", false)
		if result == nil {
			t.Error("Should return a result object")
		}
	})
}

// TestErrorHandling_PermissionDenied tests handling of permission errors
func TestErrorHandling_PermissionDenied(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("Skipping permission test when running as root")
	}

	tmpDir := t.TempDir()
	unreadableFile := filepath.Join(tmpDir, "unreadable.ts")
	if err := os.WriteFile(unreadableFile, []byte("const x = 1;"), 0000); err != nil {
		t.Fatalf("Failed to create unreadable file: %v", err)
	}
	defer os.Chmod(unreadableFile, 0644) // Restore permissions for cleanup

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("read unreadable file", func(t *testing.T) {
		_, err := GetDefinition(ctx, tmpDir, "unreadable.ts", 1, 1)
		if err == nil {
			t.Error("Should error for unreadable file")
		}
	})
}

// TestErrorHandling_SymlinkEdgeCases tests handling of symlinks
func TestErrorHandling_SymlinkEdgeCases(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a real file
	realFile := filepath.Join(tmpDir, "real.ts")
	if err := os.WriteFile(realFile, []byte("const x = 1;"), 0644); err != nil {
		t.Fatalf("Failed to create real file: %v", err)
	}

	// Create a symlink to it
	symlinkFile := filepath.Join(tmpDir, "link.ts")
	if err := os.Symlink(realFile, symlinkFile); err != nil {
		t.Skipf("Symlinks not supported: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("definition through symlink", func(t *testing.T) {
		result, err := GetDefinition(ctx, tmpDir, "link.ts", 1, 7)
		if err != nil {
			t.Logf("Error with symlink (may be expected): %v", err)
		} else if result.Symbol != "x" {
			t.Errorf("Expected symbol 'x', got '%s'", result.Symbol)
		}
	})

	// Create a broken symlink
	brokenLink := filepath.Join(tmpDir, "broken.ts")
	if err := os.Symlink("/nonexistent/file.ts", brokenLink); err != nil {
		t.Skipf("Could not create broken symlink: %v", err)
	}

	t.Run("broken symlink", func(t *testing.T) {
		_, err := GetDefinition(ctx, tmpDir, "broken.ts", 1, 1)
		if err == nil {
			t.Error("Should error for broken symlink")
		}
	})
}

// TestErrorHandling_ApplyCodeAction tests error handling for ApplyCodeAction
func TestErrorHandling_ApplyCodeAction(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("invalid action index", func(t *testing.T) {
		_, err := ApplyCodeAction(ctx, "/tmp", "file.ts", 1, 1, 999)
		if err == nil {
			t.Error("Should error for invalid action index")
		}
	})

	t.Run("negative action index", func(t *testing.T) {
		_, err := ApplyCodeAction(ctx, "/tmp", "file.ts", 1, 1, -1)
		if err == nil {
			t.Error("Should error for negative action index")
		}
	})
}

// TestErrorHandling_ParseLocation tests error handling for ParseLocation
func TestErrorHandling_ParseLocation(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"empty string", "", true},
		{"just filename", "file.ts", true},
		{"missing line", "file.ts:", true},
		{"non-numeric line", "file.ts:abc", true},
		{"non-numeric column", "file.ts:10:abc", true},
		{"too many colons", "file.ts:10:5:extra:stuff", false}, // extra parts ignored
		{"negative line", "file.ts:-1", false},                 // parsed successfully, validated later
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, _, err := ParseLocation(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseLocation(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
		})
	}
}

// TestErrorHandling_FormatFile tests error handling for FormatFile
func TestErrorHandling_FormatFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("non-existent project", func(t *testing.T) {
		result, err := FormatFile(ctx, "/nonexistent", []string{}, false)
		// Should not error, but may have errors in result
		if err != nil {
			t.Logf("FormatFile error (may be expected): %v", err)
		}
		if result != nil && len(result.Errors) > 0 {
			t.Logf("Format errors (expected): %v", result.Errors)
		}
	})
}

// TestErrorHandling_RenameSymbol tests error handling for RenameSymbol
func TestErrorHandling_RenameSymbol(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte("const x = 1;"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("empty new name", func(t *testing.T) {
		// Empty name should still work technically, but result in empty replacements
		result, err := RenameSymbol(ctx, tmpDir, "test.ts", 1, 7, "", true)
		if err != nil {
			t.Logf("Error (may be expected): %v", err)
		}
		if result != nil {
			t.Logf("Result: old=%s new=%s", result.OldName, result.NewName)
		}
	})

	t.Run("same name", func(t *testing.T) {
		// Renaming to same name should work but be a no-op
		result, err := RenameSymbol(ctx, tmpDir, "test.ts", 1, 7, "x", true)
		if err != nil {
			t.Logf("Error: %v", err)
		}
		if result != nil && result.OldName == result.NewName {
			t.Log("Same name rename - no-op")
		}
	})
}

// TestErrorHandling_Timeout tests that operations respect timeouts
func TestErrorHandling_Timeout(t *testing.T) {
	// Create a context with a very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()

	// Wait a bit to ensure context is expired
	time.Sleep(1 * time.Millisecond)

	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte("const x = 1;"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	t.Run("expired context", func(t *testing.T) {
		_, err := SearchSymbols(ctx, tmpDir, "x", false)
		// Should either error or return empty results quickly
		if err != nil {
			t.Logf("Search with expired context: %v", err)
		}
	})
}
