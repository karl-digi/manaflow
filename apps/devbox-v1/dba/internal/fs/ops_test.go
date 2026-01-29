// internal/fs/ops_test.go
package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ==================== COPY TESTS ====================

func TestCopyFileBasic(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source file
	content := "source content"
	srcFile := filepath.Join(tmpDir, "source.txt")
	if err := os.WriteFile(srcFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Copy(tmpDir, "source.txt", "dest.txt", false)
	if err != nil {
		t.Fatalf("Copy failed: %v", err)
	}

	if result.BytesCopied != int64(len(content)) {
		t.Errorf("Expected %d bytes copied, got %d", len(content), result.BytesCopied)
	}

	// Verify destination exists
	destContent, err := os.ReadFile(filepath.Join(tmpDir, "dest.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(destContent) != content {
		t.Errorf("Destination content mismatch")
	}

	// Verify source still exists
	_, err = os.Stat(srcFile)
	if err != nil {
		t.Error("Source file should still exist after copy")
	}
}

func TestCopyDirectoryRecursive(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source directory structure
	os.MkdirAll(filepath.Join(tmpDir, "srcdir", "subdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "srcdir", "file1.txt"), []byte("file1"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "srcdir", "subdir", "file2.txt"), []byte("file2"), 0644)

	result, err := Copy(tmpDir, "srcdir", "destdir", true)
	if err != nil {
		t.Fatalf("Copy directory failed: %v", err)
	}

	if result.BytesCopied < 10 {
		t.Errorf("Expected more bytes copied, got %d", result.BytesCopied)
	}

	// Verify structure
	_, err = os.Stat(filepath.Join(tmpDir, "destdir", "file1.txt"))
	if err != nil {
		t.Error("file1.txt should exist in dest")
	}

	_, err = os.Stat(filepath.Join(tmpDir, "destdir", "subdir", "file2.txt"))
	if err != nil {
		t.Error("subdir/file2.txt should exist in dest")
	}
}

func TestCopyDirectoryWithoutRecursive(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.Mkdir(filepath.Join(tmpDir, "srcdir"), 0755)

	_, err = Copy(tmpDir, "srcdir", "destdir", false)
	if err == nil {
		t.Error("Expected error when copying directory without recursive flag")
	}

	if !strings.Contains(err.Error(), "recursive") {
		t.Errorf("Error should mention 'recursive', got: %v", err)
	}
}

func TestCopyNonExistent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Copy(tmpDir, "nonexistent.txt", "dest.txt", false)
	if err == nil {
		t.Error("Expected error for non-existent source")
	}

	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Error should mention 'not found', got: %v", err)
	}
}

func TestCopyPreservesPermissions(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source with specific permissions
	srcFile := filepath.Join(tmpDir, "source.txt")
	if err := os.WriteFile(srcFile, []byte("content"), 0755); err != nil {
		t.Fatal(err)
	}

	_, err = Copy(tmpDir, "source.txt", "dest.txt", false)
	if err != nil {
		t.Fatalf("Copy failed: %v", err)
	}

	destInfo, err := os.Stat(filepath.Join(tmpDir, "dest.txt"))
	if err != nil {
		t.Fatal(err)
	}

	srcInfo, _ := os.Stat(srcFile)
	if destInfo.Mode() != srcInfo.Mode() {
		t.Errorf("Permissions not preserved: src=%v, dest=%v", srcInfo.Mode(), destInfo.Mode())
	}
}

func TestCopyToNestedPath(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte("content"), 0644)

	// Copy to nested destination (directory doesn't exist)
	_, err = Copy(tmpDir, "source.txt", "a/b/c/dest.txt", false)
	if err != nil {
		t.Fatalf("Copy to nested path failed: %v", err)
	}

	// Verify file was created
	_, err = os.Stat(filepath.Join(tmpDir, "a", "b", "c", "dest.txt"))
	if err != nil {
		t.Error("Destination file should exist in nested path")
	}
}

func TestCopyOverwrite(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source and existing destination
	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte("new content"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "dest.txt"), []byte("old content"), 0644)

	_, err = Copy(tmpDir, "source.txt", "dest.txt", false)
	if err != nil {
		t.Fatalf("Copy overwrite failed: %v", err)
	}

	// Verify content is overwritten
	content, _ := os.ReadFile(filepath.Join(tmpDir, "dest.txt"))
	if string(content) != "new content" {
		t.Errorf("Expected 'new content', got %q", string(content))
	}
}

func TestCopyTextOutput(t *testing.T) {
	result := &CopyResult{
		Source:      "src.txt",
		Destination: "dst.txt",
		BytesCopied: 1024,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "src.txt") {
		t.Error("TextOutput should contain source")
	}
	if !strings.Contains(output, "dst.txt") {
		t.Error("TextOutput should contain destination")
	}
	if !strings.Contains(output, "1024") {
		t.Error("TextOutput should contain bytes copied")
	}
}

// ==================== MOVE TESTS ====================

func TestMoveFileBasic(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	content := "source content"
	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte(content), 0644)

	result, err := Move(tmpDir, "source.txt", "dest.txt")
	if err != nil {
		t.Fatalf("Move failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}

	// Verify source doesn't exist
	_, err = os.Stat(filepath.Join(tmpDir, "source.txt"))
	if !os.IsNotExist(err) {
		t.Error("Source should not exist after move")
	}

	// Verify destination exists
	destContent, err := os.ReadFile(filepath.Join(tmpDir, "dest.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(destContent) != content {
		t.Error("Destination content should match source")
	}
}

func TestMoveDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source directory
	os.MkdirAll(filepath.Join(tmpDir, "srcdir", "subdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "srcdir", "file.txt"), []byte("content"), 0644)

	result, err := Move(tmpDir, "srcdir", "destdir")
	if err != nil {
		t.Fatalf("Move directory failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}

	// Verify source doesn't exist
	_, err = os.Stat(filepath.Join(tmpDir, "srcdir"))
	if !os.IsNotExist(err) {
		t.Error("Source directory should not exist after move")
	}

	// Verify destination structure
	_, err = os.Stat(filepath.Join(tmpDir, "destdir", "file.txt"))
	if err != nil {
		t.Error("Destination should have file.txt")
	}
}

func TestMoveNonExistent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Move(tmpDir, "nonexistent.txt", "dest.txt")
	if err == nil {
		t.Error("Expected error for non-existent source")
	}

	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Error should mention 'not found', got: %v", err)
	}
}

func TestMoveToNestedPath(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte("content"), 0644)

	// Move to nested destination
	_, err = Move(tmpDir, "source.txt", "a/b/c/dest.txt")
	if err != nil {
		t.Fatalf("Move to nested path failed: %v", err)
	}

	// Verify file was moved
	_, err = os.Stat(filepath.Join(tmpDir, "a", "b", "c", "dest.txt"))
	if err != nil {
		t.Error("Destination file should exist")
	}
}

func TestMoveRename(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "old.txt"), []byte("content"), 0644)

	// Rename in same directory
	result, err := Move(tmpDir, "old.txt", "new.txt")
	if err != nil {
		t.Fatalf("Rename failed: %v", err)
	}

	if result.Source != "old.txt" || result.Destination != "new.txt" {
		t.Error("Result should reflect source and destination")
	}

	// Verify rename
	_, err = os.Stat(filepath.Join(tmpDir, "old.txt"))
	if !os.IsNotExist(err) {
		t.Error("Old name should not exist")
	}

	_, err = os.Stat(filepath.Join(tmpDir, "new.txt"))
	if err != nil {
		t.Error("New name should exist")
	}
}

func TestMoveTextOutput(t *testing.T) {
	result := &MoveResult{
		Source:      "src.txt",
		Destination: "dst.txt",
		Success:     true,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "src.txt") {
		t.Error("TextOutput should contain source")
	}
	if !strings.Contains(output, "dst.txt") {
		t.Error("TextOutput should contain destination")
	}
}

// ==================== REMOVE TESTS ====================

func TestRemoveFileBasic(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("content"), 0644)

	result, err := Remove(tmpDir, "test.txt", false)
	if err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}

	// Verify file doesn't exist
	_, err = os.Stat(testFile)
	if !os.IsNotExist(err) {
		t.Error("File should not exist after remove")
	}
}

func TestRemoveDirectoryRecursive(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create directory structure
	os.MkdirAll(filepath.Join(tmpDir, "dir", "subdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "dir", "file.txt"), []byte("content"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "dir", "subdir", "nested.txt"), []byte("nested"), 0644)

	result, err := Remove(tmpDir, "dir", true)
	if err != nil {
		t.Fatalf("Remove recursive failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}

	// Verify directory doesn't exist
	_, err = os.Stat(filepath.Join(tmpDir, "dir"))
	if !os.IsNotExist(err) {
		t.Error("Directory should not exist after remove")
	}
}

func TestRemoveDirectoryWithoutRecursive(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create non-empty directory
	os.Mkdir(filepath.Join(tmpDir, "dir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "dir", "file.txt"), []byte("content"), 0644)

	_, err = Remove(tmpDir, "dir", false)
	if err == nil {
		t.Error("Expected error when removing directory without recursive")
	}

	if !strings.Contains(err.Error(), "recursive") {
		t.Errorf("Error should mention 'recursive', got: %v", err)
	}
}

func TestRemoveEmptyDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.Mkdir(filepath.Join(tmpDir, "emptydir"), 0755)

	// Empty directory should fail without recursive (it's still a directory)
	_, err = Remove(tmpDir, "emptydir", false)
	if err == nil {
		t.Error("Expected error when removing directory without recursive")
	}

	// Should succeed with recursive
	result, err := Remove(tmpDir, "emptydir", true)
	if err != nil {
		t.Fatalf("Remove empty dir with recursive failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}
}

func TestRemoveNonExistent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Remove(tmpDir, "nonexistent.txt", false)
	if err == nil {
		t.Error("Expected error for non-existent path")
	}

	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Error should mention 'not found', got: %v", err)
	}
}

func TestRemoveTextOutput(t *testing.T) {
	result := &RemoveResult{
		Path:    "deleted.txt",
		Success: true,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "deleted.txt") {
		t.Error("TextOutput should contain path")
	}
	if !strings.Contains(output, "Removed") {
		t.Error("TextOutput should contain 'Removed'")
	}
}

// ==================== MKDIR TESTS ====================

func TestMkdirBasic(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	result, err := Mkdir(tmpDir, "newdir", false)
	if err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}

	// Verify directory exists
	info, err := os.Stat(filepath.Join(tmpDir, "newdir"))
	if err != nil {
		t.Fatal(err)
	}

	if !info.IsDir() {
		t.Error("Created path should be a directory")
	}
}

func TestMkdirNestedWithParents(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	result, err := Mkdir(tmpDir, "a/b/c/d/e", true)
	if err != nil {
		t.Fatalf("Mkdir nested failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}

	// Verify all directories exist
	_, err = os.Stat(filepath.Join(tmpDir, "a", "b", "c", "d", "e"))
	if err != nil {
		t.Error("Nested directories should exist")
	}
}

func TestMkdirNestedWithoutParents(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Mkdir(tmpDir, "a/b/c", false)
	if err == nil {
		t.Error("Expected error when creating nested dir without parents flag")
	}
}

func TestMkdirExisting(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create directory first
	os.Mkdir(filepath.Join(tmpDir, "existing"), 0755)

	// Try to create again without parents
	_, err = Mkdir(tmpDir, "existing", false)
	if err == nil {
		t.Error("Expected error when creating existing directory")
	}

	// With parents flag, should succeed (or at least not error)
	result, err := Mkdir(tmpDir, "existing", true)
	if err != nil {
		t.Fatalf("Mkdir existing with parents failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected Success to be true")
	}
}

func TestMkdirSpecialCharactersInName(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	specialNames := []string{
		"dir with spaces",
		"dir-with-dashes",
		"dir_with_underscores",
		"dir.with.dots",
	}

	for _, name := range specialNames {
		result, err := Mkdir(tmpDir, name, false)
		if err != nil {
			t.Errorf("Mkdir %q failed: %v", name, err)
			continue
		}

		if !result.Success {
			t.Errorf("Mkdir %q: expected Success to be true", name)
		}

		// Verify directory exists
		_, err = os.Stat(filepath.Join(tmpDir, name))
		if err != nil {
			t.Errorf("Directory %q should exist", name)
		}
	}
}

func TestMkdirTextOutput(t *testing.T) {
	result := &MkdirResult{
		Path:    "newdir",
		Success: true,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "newdir") {
		t.Error("TextOutput should contain path")
	}
	if !strings.Contains(output, "Created") {
		t.Error("TextOutput should contain 'Created'")
	}
}

func TestMkdirPermissions(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = Mkdir(tmpDir, "newdir", false)
	if err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(tmpDir, "newdir"))
	if err != nil {
		t.Fatal(err)
	}

	// Default permissions should be 0755
	expectedPerm := os.FileMode(0755)
	actualPerm := info.Mode().Perm()
	if actualPerm != expectedPerm {
		t.Errorf("Expected permissions %v, got %v", expectedPerm, actualPerm)
	}
}

// ==================== COMBINED OPERATIONS TESTS ====================

func TestCopyThenRemove(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte("content"), 0644)

	// Copy
	_, err = Copy(tmpDir, "source.txt", "copy.txt", false)
	if err != nil {
		t.Fatalf("Copy failed: %v", err)
	}

	// Remove source
	_, err = Remove(tmpDir, "source.txt", false)
	if err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	// Verify copy still exists
	_, err = os.Stat(filepath.Join(tmpDir, "copy.txt"))
	if err != nil {
		t.Error("Copy should still exist")
	}
}

func TestMkdirThenMove(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_ops_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source file
	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("content"), 0644)

	// Create directory
	_, err = Mkdir(tmpDir, "newdir", false)
	if err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}

	// Move file into new directory
	_, err = Move(tmpDir, "file.txt", "newdir/file.txt")
	if err != nil {
		t.Fatalf("Move failed: %v", err)
	}

	// Verify
	_, err = os.Stat(filepath.Join(tmpDir, "newdir", "file.txt"))
	if err != nil {
		t.Error("File should be in new directory")
	}
}
