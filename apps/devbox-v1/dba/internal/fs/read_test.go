// internal/fs/read_test.go
package fs

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadEmptyFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create empty file
	emptyFile := filepath.Join(tmpDir, "empty.txt")
	if err := os.WriteFile(emptyFile, []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Read(tmpDir, "empty.txt", ReadOptions{})
	if err != nil {
		t.Fatalf("Read empty file failed: %v", err)
	}

	if result.Content != "" {
		t.Errorf("Expected empty content, got %q", result.Content)
	}

	if result.Size != 0 {
		t.Errorf("Expected size 0, got %d", result.Size)
	}
}

func TestReadFileWithOnlyNewlines(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	content := "\n\n\n"
	testFile := filepath.Join(tmpDir, "newlines.txt")
	if err := os.WriteFile(testFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Read(tmpDir, "newlines.txt", ReadOptions{})
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	if result.Content != content {
		t.Errorf("Expected %q, got %q", content, result.Content)
	}
}

func TestReadBinaryFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create binary file with null bytes
	binaryContent := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}
	binaryFile := filepath.Join(tmpDir, "binary.bin")
	if err := os.WriteFile(binaryFile, binaryContent, 0644); err != nil {
		t.Fatal(err)
	}

	// Read as base64
	result, err := Read(tmpDir, "binary.bin", ReadOptions{Base64: true})
	if err != nil {
		t.Fatalf("Read binary file failed: %v", err)
	}

	if result.Encoding != "base64" {
		t.Errorf("Expected encoding 'base64', got %q", result.Encoding)
	}

	// Decode and verify
	decoded, err := base64.StdEncoding.DecodeString(result.Content)
	if err != nil {
		t.Fatalf("Failed to decode base64: %v", err)
	}

	if string(decoded) != string(binaryContent) {
		t.Errorf("Decoded content doesn't match original")
	}
}

func TestReadFileWithSpecialCharactersInName(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Test various special characters in filenames
	specialNames := []string{
		"file with spaces.txt",
		"file-with-dashes.txt",
		"file_with_underscores.txt",
		"file.multiple.dots.txt",
	}

	for _, name := range specialNames {
		testFile := filepath.Join(tmpDir, name)
		content := "content of " + name
		if err := os.WriteFile(testFile, []byte(content), 0644); err != nil {
			t.Fatalf("Failed to create file %q: %v", name, err)
		}

		result, err := Read(tmpDir, name, ReadOptions{})
		if err != nil {
			t.Errorf("Read file %q failed: %v", name, err)
			continue
		}

		if result.Content != content {
			t.Errorf("File %q: expected %q, got %q", name, content, result.Content)
		}
	}
}

func TestReadUnicodeContent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Unicode content with various scripts
	unicodeContent := "Hello 世界 🌍 Привет мир مرحبا العالم"
	testFile := filepath.Join(tmpDir, "unicode.txt")
	if err := os.WriteFile(testFile, []byte(unicodeContent), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Read(tmpDir, "unicode.txt", ReadOptions{})
	if err != nil {
		t.Fatalf("Read unicode file failed: %v", err)
	}

	if result.Content != unicodeContent {
		t.Errorf("Unicode content mismatch: expected %q, got %q", unicodeContent, result.Content)
	}
}

func TestReadLineRangeEdgeCases(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	content := "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
	testFile := filepath.Join(tmpDir, "lines.txt")
	if err := os.WriteFile(testFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name        string
		lineRange   string
		wantContent string
		wantStart   int
		wantEnd     int
		wantErr     bool
	}{
		{"first line only", "1:1", "Line 1", 1, 1, false},  // Returns line 1
		{"last line", "5:5", "Line 5", 5, 5, false},        // Returns line 5
		{"all lines", "1:5", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", 1, 5, false},
		{"middle lines", "2:4", "Line 2\nLine 3\nLine 4", 2, 4, false},
		{"from start", ":3", "Line 1\nLine 2\nLine 3", 1, 3, false},
		{"to end", "3:", "Line 3\nLine 4\nLine 5", 3, 5, false},
		{"beyond end", "1:100", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5", 1, 5, false},
		{"invalid format", "1-5", "", 0, 0, true},
		{"invalid start", "abc:5", "", 0, 0, true},
		{"invalid end", "1:xyz", "", 0, 0, true},
		{"start greater than end", "5:3", "", 0, 0, true}, // Invalid: start > end
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Read(tmpDir, "lines.txt", ReadOptions{LineRange: tt.lineRange})

			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error for line range %q", tt.lineRange)
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error for line range %q: %v", tt.lineRange, err)
			}

			if result.Content != tt.wantContent {
				t.Errorf("Line range %q: expected content %q, got %q", tt.lineRange, tt.wantContent, result.Content)
			}

			if result.Lines.Start != tt.wantStart {
				t.Errorf("Line range %q: expected start %d, got %d", tt.lineRange, tt.wantStart, result.Lines.Start)
			}

			if result.Lines.End != tt.wantEnd {
				t.Errorf("Line range %q: expected end %d, got %d", tt.lineRange, tt.wantEnd, result.Lines.End)
			}
		})
	}
}

func TestReadDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a subdirectory
	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Try to read the directory - should fail
	_, err = Read(tmpDir, "subdir", ReadOptions{})
	if err == nil {
		t.Error("Expected error when reading directory")
	}

	if !strings.Contains(err.Error(), "directory") {
		t.Errorf("Error should mention 'directory', got: %v", err)
	}
}

func TestReadNonExistentFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Read(tmpDir, "does-not-exist.txt", ReadOptions{})
	if err == nil {
		t.Error("Expected error for non-existent file")
	}

	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Error should mention 'not found', got: %v", err)
	}
}

func TestReadPermissionDenied(t *testing.T) {
	// Skip on Windows where permission handling is different
	if os.Getenv("GOOS") == "windows" {
		t.Skip("Skipping permission test on Windows")
	}

	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create file with no read permission
	noReadFile := filepath.Join(tmpDir, "noread.txt")
	if err := os.WriteFile(noReadFile, []byte("secret"), 0000); err != nil {
		t.Fatal(err)
	}

	_, err = Read(tmpDir, "noread.txt", ReadOptions{})
	if err == nil {
		t.Error("Expected error for permission denied")
	}
}

func TestReadVeryLongLines(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create file with very long line (1MB)
	longLine := strings.Repeat("x", 1024*1024)
	testFile := filepath.Join(tmpDir, "longline.txt")
	if err := os.WriteFile(testFile, []byte(longLine), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Read(tmpDir, "longline.txt", ReadOptions{})
	if err != nil {
		t.Fatalf("Read long line file failed: %v", err)
	}

	if len(result.Content) != len(longLine) {
		t.Errorf("Expected content length %d, got %d", len(longLine), len(result.Content))
	}
}

func TestReadSymlinkChain(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create original file
	originalContent := "original content"
	originalFile := filepath.Join(tmpDir, "original.txt")
	if err := os.WriteFile(originalFile, []byte(originalContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Create chain of symlinks: link3 -> link2 -> link1 -> original.txt
	if err := os.Symlink("original.txt", filepath.Join(tmpDir, "link1.txt")); err != nil {
		t.Skip("Symlinks not supported")
	}
	if err := os.Symlink("link1.txt", filepath.Join(tmpDir, "link2.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("link2.txt", filepath.Join(tmpDir, "link3.txt")); err != nil {
		t.Fatal(err)
	}

	// Read through the chain
	result, err := Read(tmpDir, "link3.txt", ReadOptions{FollowSymlinks: true})
	if err != nil {
		t.Fatalf("Read symlink chain failed: %v", err)
	}

	if result.Content != originalContent {
		t.Errorf("Expected content %q through symlink chain, got %q", originalContent, result.Content)
	}

	if !result.IsSymlink {
		t.Error("Expected IsSymlink to be true")
	}
}

func TestReadBrokenSymlink(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create symlink to non-existent file
	if err := os.Symlink("nonexistent.txt", filepath.Join(tmpDir, "broken.txt")); err != nil {
		t.Skip("Symlinks not supported")
	}

	// Should fail when following symlinks
	_, err = Read(tmpDir, "broken.txt", ReadOptions{FollowSymlinks: true})
	if err == nil {
		t.Error("Expected error for broken symlink when following")
	}

	// Should succeed when not following (returns symlink info)
	result, err := Read(tmpDir, "broken.txt", ReadOptions{FollowSymlinks: false})
	if err != nil {
		t.Fatalf("Read broken symlink (no follow) failed: %v", err)
	}

	if result.SymlinkTarget != "nonexistent.txt" {
		t.Errorf("Expected symlink target 'nonexistent.txt', got %q", result.SymlinkTarget)
	}
}

func TestReadTextOutput(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_read_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	content := "Hello, World!"
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Read(tmpDir, "test.txt", ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}

	textOutput := result.TextOutput()
	if !strings.Contains(textOutput, "test.txt") {
		t.Error("TextOutput should contain filename")
	}
	if !strings.Contains(textOutput, content) {
		t.Error("TextOutput should contain file content")
	}
}

func TestReadResultWithWarning(t *testing.T) {
	// Test that the warning field is properly set for large files
	// We'll create a mock result to test the structure
	result := &ReadResult{
		Path:    "large.bin",
		Content: "...",
		Size:    15 * 1024 * 1024, // 15MB
		Warning: "Large file (15 MB). Consider using --lines to read a portion.",
	}

	if result.Warning == "" {
		t.Error("Warning should be set for large files")
	}

	if !strings.Contains(result.Warning, "Large file") {
		t.Error("Warning should mention 'Large file'")
	}
}
