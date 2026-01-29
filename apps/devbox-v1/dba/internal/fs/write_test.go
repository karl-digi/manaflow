// internal/fs/write_test.go
package fs

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteEmptyContent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	result, err := Write(tmpDir, "empty.txt", WriteOptions{Content: ""})
	if err != nil {
		t.Fatalf("Write empty content failed: %v", err)
	}

	if result.BytesWritten != 0 {
		t.Errorf("Expected 0 bytes written, got %d", result.BytesWritten)
	}

	if !result.Created {
		t.Error("Expected Created to be true for new file")
	}

	// Verify file exists and is empty
	content, err := os.ReadFile(filepath.Join(tmpDir, "empty.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if len(content) != 0 {
		t.Errorf("Expected empty file, got %d bytes", len(content))
	}
}

func TestWriteBinaryContentWithBase64(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Binary data with null bytes
	binaryData := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD, 0x89, 0x50, 0x4E, 0x47}
	base64Content := base64.StdEncoding.EncodeToString(binaryData)

	result, err := Write(tmpDir, "binary.bin", WriteOptions{
		Content: base64Content,
		Base64:  true,
	})
	if err != nil {
		t.Fatalf("Write binary content failed: %v", err)
	}

	if result.BytesWritten != len(binaryData) {
		t.Errorf("Expected %d bytes written, got %d", len(binaryData), result.BytesWritten)
	}

	// Verify content
	readContent, err := os.ReadFile(filepath.Join(tmpDir, "binary.bin"))
	if err != nil {
		t.Fatal(err)
	}

	if string(readContent) != string(binaryData) {
		t.Error("Binary content mismatch")
	}
}

func TestWriteInvalidBase64(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Write(tmpDir, "test.txt", WriteOptions{
		Content: "not-valid-base64!!!",
		Base64:  true,
	})

	if err == nil {
		t.Error("Expected error for invalid base64")
	}

	if !strings.Contains(err.Error(), "base64") {
		t.Errorf("Error should mention 'base64', got: %v", err)
	}
}

func TestWriteOverwriteExisting(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial file
	initialContent := "initial content"
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte(initialContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Overwrite with new content
	newContent := "new content"
	result, err := Write(tmpDir, "test.txt", WriteOptions{Content: newContent})
	if err != nil {
		t.Fatalf("Write overwrite failed: %v", err)
	}

	if result.Created {
		t.Error("Expected Created to be false for existing file")
	}

	// Verify content is overwritten
	readContent, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatal(err)
	}

	if string(readContent) != newContent {
		t.Errorf("Expected %q, got %q", newContent, string(readContent))
	}
}

func TestWriteAppendMode(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial file
	initialContent := "Line 1\n"
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte(initialContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Append content
	appendContent := "Line 2\n"
	_, err = Write(tmpDir, "test.txt", WriteOptions{
		Content: appendContent,
		Append:  true,
	})
	if err != nil {
		t.Fatalf("Write append failed: %v", err)
	}

	// Verify combined content
	readContent, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatal(err)
	}

	expected := initialContent + appendContent
	if string(readContent) != expected {
		t.Errorf("Expected %q, got %q", expected, string(readContent))
	}
}

func TestWriteAppendToNonExistent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Append to non-existent file should create it
	content := "new content"
	result, err := Write(tmpDir, "new.txt", WriteOptions{
		Content: content,
		Append:  true,
	})
	if err != nil {
		t.Fatalf("Write append to new file failed: %v", err)
	}

	if !result.Created {
		t.Error("Expected Created to be true for new file")
	}

	// Verify content
	readContent, err := os.ReadFile(filepath.Join(tmpDir, "new.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(readContent) != content {
		t.Errorf("Expected %q, got %q", content, string(readContent))
	}
}

func TestWriteWithMkdirP(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Write to nested path that doesn't exist
	content := "nested content"
	result, err := Write(tmpDir, "a/b/c/d/file.txt", WriteOptions{
		Content: content,
		MkdirP:  true,
	})
	if err != nil {
		t.Fatalf("Write with mkdir failed: %v", err)
	}

	if !result.Created {
		t.Error("Expected Created to be true")
	}

	// Verify file exists
	readContent, err := os.ReadFile(filepath.Join(tmpDir, "a/b/c/d/file.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(readContent) != content {
		t.Errorf("Expected %q, got %q", content, string(readContent))
	}
}

func TestWriteWithoutMkdirP(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Write to nested path without mkdir - should fail
	_, err = Write(tmpDir, "nonexistent/dir/file.txt", WriteOptions{
		Content: "content",
		MkdirP:  false,
	})

	if err == nil {
		t.Error("Expected error when parent directory doesn't exist")
	}
}

func TestWriteUnicodeContent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Unicode content
	unicodeContent := "Hello 世界 🌍 Привет"
	result, err := Write(tmpDir, "unicode.txt", WriteOptions{Content: unicodeContent})
	if err != nil {
		t.Fatalf("Write unicode content failed: %v", err)
	}

	// Verify bytes written matches UTF-8 encoding
	if result.BytesWritten != len(unicodeContent) {
		t.Errorf("Expected %d bytes, got %d", len(unicodeContent), result.BytesWritten)
	}

	// Verify content
	readContent, err := os.ReadFile(filepath.Join(tmpDir, "unicode.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(readContent) != unicodeContent {
		t.Errorf("Unicode content mismatch")
	}
}

func TestWriteVeryLargeContent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Write 1MB of content
	largeContent := strings.Repeat("x", 1024*1024)
	result, err := Write(tmpDir, "large.txt", WriteOptions{Content: largeContent})
	if err != nil {
		t.Fatalf("Write large content failed: %v", err)
	}

	if result.BytesWritten != len(largeContent) {
		t.Errorf("Expected %d bytes, got %d", len(largeContent), result.BytesWritten)
	}
}

func TestWriteSpecialCharactersInPath(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
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
		content := "content of " + name
		result, err := Write(tmpDir, name, WriteOptions{Content: content})
		if err != nil {
			t.Errorf("Write file %q failed: %v", name, err)
			continue
		}

		if !result.Created {
			t.Errorf("File %q: expected Created to be true", name)
		}

		// Verify content
		readContent, err := os.ReadFile(filepath.Join(tmpDir, name))
		if err != nil {
			t.Errorf("Read file %q failed: %v", name, err)
			continue
		}

		if string(readContent) != content {
			t.Errorf("File %q: content mismatch", name)
		}
	}
}

func TestWriteTextOutput(t *testing.T) {
	result := &WriteResult{
		Path:          "test.txt",
		BytesWritten:  100,
		Created:       true,
		SyncTriggered: true,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "Created") {
		t.Error("TextOutput should contain 'Created' for new files")
	}
	if !strings.Contains(output, "test.txt") {
		t.Error("TextOutput should contain filename")
	}
	if !strings.Contains(output, "100") {
		t.Error("TextOutput should contain bytes written")
	}

	// Test for updated file
	result.Created = false
	output = result.TextOutput()
	if !strings.Contains(output, "Updated") {
		t.Error("TextOutput should contain 'Updated' for existing files")
	}
}

func TestWriteMultipleAppends(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Multiple appends
	lines := []string{"Line 1\n", "Line 2\n", "Line 3\n"}
	for _, line := range lines {
		_, err := Write(tmpDir, "log.txt", WriteOptions{
			Content: line,
			Append:  true,
		})
		if err != nil {
			t.Fatalf("Write append failed: %v", err)
		}
	}

	// Verify all content
	readContent, err := os.ReadFile(filepath.Join(tmpDir, "log.txt"))
	if err != nil {
		t.Fatal(err)
	}

	expected := strings.Join(lines, "")
	if string(readContent) != expected {
		t.Errorf("Expected %q, got %q", expected, string(readContent))
	}
}

func TestWriteSyncTriggered(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_write_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	result, err := Write(tmpDir, "test.txt", WriteOptions{Content: "content"})
	if err != nil {
		t.Fatal(err)
	}

	// SyncTriggered should always be true (for file watcher integration)
	if !result.SyncTriggered {
		t.Error("Expected SyncTriggered to be true")
	}
}
