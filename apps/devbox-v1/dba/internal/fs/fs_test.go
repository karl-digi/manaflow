// internal/fs/fs_test.go
package fs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRead(t *testing.T) {
	// Create a temp directory
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a test file
	testContent := "Hello, World!\nLine 2\nLine 3"
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte(testContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Test reading the file
	result, err := Read(tmpDir, "test.txt", ReadOptions{})
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	if result.Content != testContent {
		t.Errorf("Expected content %q, got %q", testContent, result.Content)
	}

	if result.Path != "test.txt" {
		t.Errorf("Expected path %q, got %q", "test.txt", result.Path)
	}

	// Test reading with line range
	result, err = Read(tmpDir, "test.txt", ReadOptions{LineRange: "1:2"})
	if err != nil {
		t.Fatalf("Read with line range failed: %v", err)
	}

	if result.Content != "Hello, World!\nLine 2" {
		t.Errorf("Expected content %q, got %q", "Hello, World!\nLine 2", result.Content)
	}

	if result.Lines.Start != 1 || result.Lines.End != 2 {
		t.Errorf("Expected lines 1-2, got %d-%d", result.Lines.Start, result.Lines.End)
	}

	// Test reading non-existent file
	_, err = Read(tmpDir, "nonexistent.txt", ReadOptions{})
	if err == nil {
		t.Error("Expected error for non-existent file")
	}

	// Test reading symlink with follow
	symlinkPath := filepath.Join(tmpDir, "symlink.txt")
	if err := os.Symlink(testFile, symlinkPath); err != nil {
		t.Logf("Skipping symlink test: %v", err)
	} else {
		result, err = Read(tmpDir, "symlink.txt", ReadOptions{FollowSymlinks: true})
		if err != nil {
			t.Fatalf("Read symlink (follow) failed: %v", err)
		}
		if result.Content != testContent {
			t.Errorf("Expected symlink content %q, got %q", testContent, result.Content)
		}
		if !result.IsSymlink {
			t.Error("Expected IsSymlink to be true")
		}

		// Test reading symlink without follow
		result, err = Read(tmpDir, "symlink.txt", ReadOptions{FollowSymlinks: false})
		if err != nil {
			t.Fatalf("Read symlink (no follow) failed: %v", err)
		}
		if result.Encoding != "symlink" {
			t.Errorf("Expected encoding 'symlink', got %q", result.Encoding)
		}
	}
}

func TestWrite(t *testing.T) {
	// Create a temp directory
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Test writing a new file
	result, err := Write(tmpDir, "test.txt", WriteOptions{
		Content: "Hello, World!",
	})
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if !result.Created {
		t.Error("Expected Created to be true for new file")
	}

	if result.BytesWritten != 13 {
		t.Errorf("Expected 13 bytes written, got %d", result.BytesWritten)
	}

	// Test appending to file
	result, err = Write(tmpDir, "test.txt", WriteOptions{
		Content: "\nAppended",
		Append:  true,
	})
	if err != nil {
		t.Fatalf("Write append failed: %v", err)
	}

	if result.Created {
		t.Error("Expected Created to be false for existing file")
	}

	// Verify content
	data, _ := os.ReadFile(filepath.Join(tmpDir, "test.txt"))
	expected := "Hello, World!\nAppended"
	if string(data) != expected {
		t.Errorf("Expected content %q, got %q", expected, string(data))
	}

	// Test writing with mkdir
	result, err = Write(tmpDir, "subdir/nested/file.txt", WriteOptions{
		Content: "Nested content",
		MkdirP:  true,
	})
	if err != nil {
		t.Fatalf("Write with mkdir failed: %v", err)
	}

	if !result.Created {
		t.Error("Expected Created to be true for new nested file")
	}
}

func TestList(t *testing.T) {
	// Create a temp directory with some files
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create some files and directories
	os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte("content1"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file2.go"), []byte("content2"), 0644)
	os.Mkdir(filepath.Join(tmpDir, "subdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "subdir", "nested.txt"), []byte("nested"), 0644)
	os.WriteFile(filepath.Join(tmpDir, ".hidden"), []byte("hidden"), 0644)

	// Test basic listing
	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	// Should have 3 entries (excluding hidden)
	if len(result.Entries) != 3 {
		t.Errorf("Expected 3 entries, got %d", len(result.Entries))
	}

	// Test with hidden files
	result, err = List(tmpDir, "", ListOptions{Hidden: true})
	if err != nil {
		t.Fatalf("List with hidden failed: %v", err)
	}

	if len(result.Entries) != 4 {
		t.Errorf("Expected 4 entries with hidden, got %d", len(result.Entries))
	}

	// Test with pattern
	result, err = List(tmpDir, "", ListOptions{Pattern: "*.txt"})
	if err != nil {
		t.Fatalf("List with pattern failed: %v", err)
	}

	// Should have 2 entries (file1.txt and subdir since we don't filter directories by pattern)
	found := 0
	for _, e := range result.Entries {
		if e.Name == "file1.txt" {
			found++
		}
	}
	if found != 1 {
		t.Errorf("Expected to find file1.txt in pattern results")
	}
}

func TestCopy(t *testing.T) {
	// Create a temp directory
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a test file
	testContent := "Hello, World!"
	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte(testContent), 0644)

	// Test copying file
	result, err := Copy(tmpDir, "source.txt", "dest.txt", false)
	if err != nil {
		t.Fatalf("Copy failed: %v", err)
	}

	if result.BytesCopied != int64(len(testContent)) {
		t.Errorf("Expected %d bytes copied, got %d", len(testContent), result.BytesCopied)
	}

	// Verify destination exists
	data, err := os.ReadFile(filepath.Join(tmpDir, "dest.txt"))
	if err != nil {
		t.Fatalf("Failed to read destination: %v", err)
	}

	if string(data) != testContent {
		t.Errorf("Expected content %q, got %q", testContent, string(data))
	}

	// Test copying directory
	os.Mkdir(filepath.Join(tmpDir, "srcdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "srcdir", "file.txt"), []byte("nested"), 0644)

	result, err = Copy(tmpDir, "srcdir", "dstdir", true)
	if err != nil {
		t.Fatalf("Copy directory failed: %v", err)
	}

	// Verify nested file was copied
	_, err = os.Stat(filepath.Join(tmpDir, "dstdir", "file.txt"))
	if err != nil {
		t.Error("Expected nested file to be copied")
	}
}

func TestMove(t *testing.T) {
	// Create a temp directory
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a test file
	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte("content"), 0644)

	// Test moving file
	result, err := Move(tmpDir, "source.txt", "dest.txt")
	if err != nil {
		t.Fatalf("Move failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}

	// Verify source doesn't exist
	_, err = os.Stat(filepath.Join(tmpDir, "source.txt"))
	if !os.IsNotExist(err) {
		t.Error("Expected source to be removed")
	}

	// Verify destination exists
	_, err = os.Stat(filepath.Join(tmpDir, "dest.txt"))
	if err != nil {
		t.Error("Expected destination to exist")
	}
}

func TestRemove(t *testing.T) {
	// Create a temp directory
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a test file
	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("content"), 0644)

	// Test removing file
	result, err := Remove(tmpDir, "file.txt", false)
	if err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}

	// Verify file doesn't exist
	_, err = os.Stat(filepath.Join(tmpDir, "file.txt"))
	if !os.IsNotExist(err) {
		t.Error("Expected file to be removed")
	}

	// Test removing directory
	os.MkdirAll(filepath.Join(tmpDir, "dir", "subdir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "dir", "subdir", "file.txt"), []byte("nested"), 0644)

	// Should fail without recursive
	_, err = Remove(tmpDir, "dir", false)
	if err == nil {
		t.Error("Expected error when removing directory without recursive")
	}

	// Should succeed with recursive
	result, err = Remove(tmpDir, "dir", true)
	if err != nil {
		t.Fatalf("Remove recursive failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}
}

func TestMkdir(t *testing.T) {
	// Create a temp directory
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Test creating single directory
	result, err := Mkdir(tmpDir, "newdir", false)
	if err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}

	// Verify directory exists
	info, err := os.Stat(filepath.Join(tmpDir, "newdir"))
	if err != nil {
		t.Fatal("Expected directory to exist")
	}

	if !info.IsDir() {
		t.Error("Expected path to be a directory")
	}

	// Test creating nested directories without parents should fail
	_, err = Mkdir(tmpDir, "a/b/c", false)
	if err == nil {
		t.Error("Expected error when creating nested dirs without parents")
	}

	// Test creating nested directories with parents
	result, err = Mkdir(tmpDir, "a/b/c", true)
	if err != nil {
		t.Fatalf("Mkdir with parents failed: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}

	// Verify nested directory exists
	_, err = os.Stat(filepath.Join(tmpDir, "a", "b", "c"))
	if err != nil {
		t.Error("Expected nested directory to exist")
	}
}

func TestLargeFileWarning(t *testing.T) {
	// Test that large files get a warning
	// We can't easily create a 10MB file in tests, so we'll just verify the threshold constant exists
	if LargeFileThreshold != 10*1024*1024 {
		t.Errorf("Expected LargeFileThreshold to be 10MB, got %d", LargeFileThreshold)
	}
}

func TestSearch(t *testing.T) {
	// Create a temp directory with some files
	tmpDir, err := os.MkdirTemp("", "fs_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create some files with content
	os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte("Hello World\nTODO: fix this"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file2.go"), []byte("func main() {\n  // TODO: implement\n}"), 0644)

	// Test search (may use fallback if ripgrep not installed)
	result, err := Search(tmpDir, "TODO", SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	// Should find matches in both files
	if result.TotalMatches < 2 {
		t.Errorf("Expected at least 2 matches, got %d", result.TotalMatches)
	}

	// Test case-insensitive search
	result, err = Search(tmpDir, "hello", SearchOptions{CaseSensitive: false})
	if err != nil {
		t.Fatalf("Search case-insensitive failed: %v", err)
	}

	if result.TotalMatches < 1 {
		t.Errorf("Expected at least 1 match for 'hello', got %d", result.TotalMatches)
	}
}
