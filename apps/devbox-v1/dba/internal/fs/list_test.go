// internal/fs/list_test.go
package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListEmptyDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List empty directory failed: %v", err)
	}

	if len(result.Entries) != 0 {
		t.Errorf("Expected 0 entries, got %d", len(result.Entries))
	}

	if result.Path != "." {
		t.Errorf("Expected path '.', got %q", result.Path)
	}
}

func TestListDirectoryWithOnlyHiddenFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create only hidden files
	os.WriteFile(filepath.Join(tmpDir, ".hidden1"), []byte("1"), 0644)
	os.WriteFile(filepath.Join(tmpDir, ".hidden2"), []byte("2"), 0644)
	os.Mkdir(filepath.Join(tmpDir, ".hiddendir"), 0755)

	// Without hidden flag - should be empty
	result, err := List(tmpDir, "", ListOptions{Hidden: false})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(result.Entries) != 0 {
		t.Errorf("Expected 0 visible entries, got %d", len(result.Entries))
	}

	// With hidden flag - should have 3 entries
	result, err = List(tmpDir, "", ListOptions{Hidden: true})
	if err != nil {
		t.Fatalf("List with hidden failed: %v", err)
	}

	if len(result.Entries) != 3 {
		t.Errorf("Expected 3 hidden entries, got %d", len(result.Entries))
	}
}

func TestListDeepNesting(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create deep nesting: a/b/c/d/e/f/g/file.txt
	deepPath := filepath.Join(tmpDir, "a", "b", "c", "d", "e", "f", "g")
	if err := os.MkdirAll(deepPath, 0755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(deepPath, "file.txt"), []byte("deep"), 0644)

	// List root - should see only 'a'
	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(result.Entries) != 1 {
		t.Errorf("Expected 1 entry at root, got %d", len(result.Entries))
	}

	if result.Entries[0].Name != "a" {
		t.Errorf("Expected 'a', got %q", result.Entries[0].Name)
	}

	// Recursive list - should find the nested file
	result, err = List(tmpDir, "", ListOptions{Recursive: true})
	if err != nil {
		t.Fatalf("Recursive list failed: %v", err)
	}

	// Should have entries for all directories and the file
	foundFile := false
	for _, entry := range result.Entries {
		if strings.Contains(entry.Name, "file.txt") {
			foundFile = true
			break
		}
	}

	if !foundFile {
		t.Error("Expected to find file.txt in recursive listing")
	}
}

func TestListWithMaxDepth(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create structure: a/b/c/file.txt
	os.MkdirAll(filepath.Join(tmpDir, "a", "b", "c"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "a", "b", "c", "file.txt"), []byte("deep"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "a", "shallow.txt"), []byte("shallow"), 0644)

	// List with MaxDepth=1 - should only see 'a' directory
	result, err := List(tmpDir, "", ListOptions{Recursive: true, MaxDepth: 1})
	if err != nil {
		t.Fatalf("List with max depth failed: %v", err)
	}

	for _, entry := range result.Entries {
		if strings.Contains(entry.Name, "c") || strings.Contains(entry.Name, "file.txt") {
			t.Errorf("MaxDepth=1 should not include deep entries, found: %q", entry.Name)
		}
	}
}

func TestListPatternMatching(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create various files
	os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte("1"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file2.txt"), []byte("2"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file.go"), []byte("go"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file.js"), []byte("js"), 0644)
	os.Mkdir(filepath.Join(tmpDir, "subdir"), 0755)

	// List *.txt files
	result, err := List(tmpDir, "", ListOptions{Pattern: "*.txt"})
	if err != nil {
		t.Fatalf("List with pattern failed: %v", err)
	}

	txtCount := 0
	for _, entry := range result.Entries {
		if entry.Type == "file" && strings.HasSuffix(entry.Name, ".txt") {
			txtCount++
		}
	}

	if txtCount != 2 {
		t.Errorf("Expected 2 .txt files, got %d", txtCount)
	}
}

func TestListIgnoredDirectories(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create directories that should be ignored
	ignoredDirs := []string{"node_modules", ".git", "__pycache__", "dist", "build"}
	for _, dir := range ignoredDirs {
		os.MkdirAll(filepath.Join(tmpDir, dir), 0755)
		os.WriteFile(filepath.Join(tmpDir, dir, "file.txt"), []byte("ignored"), 0644)
	}

	// Create a normal file
	os.WriteFile(filepath.Join(tmpDir, "normal.txt"), []byte("visible"), 0644)

	result, err := List(tmpDir, "", ListOptions{GitIgnore: true})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	// Should only see normal.txt
	if len(result.Entries) != 1 {
		t.Errorf("Expected 1 entry (ignored dirs filtered), got %d", len(result.Entries))
	}

	if len(result.Entries) > 0 && result.Entries[0].Name != "normal.txt" {
		t.Errorf("Expected 'normal.txt', got %q", result.Entries[0].Name)
	}
}

func TestListSubdirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create structure
	os.MkdirAll(filepath.Join(tmpDir, "src", "components"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "src", "app.js"), []byte("app"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "src", "components", "button.js"), []byte("button"), 0644)

	// List src directory
	result, err := List(tmpDir, "src", ListOptions{})
	if err != nil {
		t.Fatalf("List subdirectory failed: %v", err)
	}

	if result.Path != "src" {
		t.Errorf("Expected path 'src', got %q", result.Path)
	}

	// Should have app.js and components
	if len(result.Entries) != 2 {
		t.Errorf("Expected 2 entries in src, got %d", len(result.Entries))
	}
}

func TestListNonExistentDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_, err = List(tmpDir, "nonexistent", ListOptions{})
	if err == nil {
		t.Error("Expected error for non-existent directory")
	}
}

func TestListFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a file
	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("content"), 0644)

	// Try to list a file - should fail
	_, err = List(tmpDir, "file.txt", ListOptions{})
	if err == nil {
		t.Error("Expected error when listing a file")
	}

	if !strings.Contains(err.Error(), "directory") {
		t.Errorf("Error should mention 'directory', got: %v", err)
	}
}

func TestListEntryTypes(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create file and directory
	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("content"), 0644)
	os.Mkdir(filepath.Join(tmpDir, "dir"), 0755)

	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	var foundFile, foundDir bool
	for _, entry := range result.Entries {
		if entry.Name == "file.txt" {
			foundFile = true
			if entry.Type != "file" {
				t.Errorf("Expected type 'file', got %q", entry.Type)
			}
			if entry.Size == 0 {
				t.Error("File size should not be 0")
			}
		}
		if entry.Name == "dir" {
			foundDir = true
			if entry.Type != "directory" {
				t.Errorf("Expected type 'directory', got %q", entry.Type)
			}
		}
	}

	if !foundFile {
		t.Error("Expected to find file.txt")
	}
	if !foundDir {
		t.Error("Expected to find dir")
	}
}

func TestListChildrenCount(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create directory with 3 files
	os.Mkdir(filepath.Join(tmpDir, "dir"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "dir", "a.txt"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "dir", "b.txt"), []byte("b"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "dir", "c.txt"), []byte("c"), 0644)

	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(result.Entries) != 1 {
		t.Fatalf("Expected 1 entry, got %d", len(result.Entries))
	}

	if result.Entries[0].Children != 3 {
		t.Errorf("Expected 3 children, got %d", result.Entries[0].Children)
	}
}

func TestListTextOutput(t *testing.T) {
	result := &ListResult{
		Path: "src",
		Entries: []Entry{
			{Name: "app.js", Type: "file", Size: 100},
			{Name: "components", Type: "directory", Children: 5},
		},
	}

	output := result.TextOutput()
	if !strings.Contains(output, "src") {
		t.Error("TextOutput should contain path")
	}
	if !strings.Contains(output, "app.js") {
		t.Error("TextOutput should contain file name")
	}
	if !strings.Contains(output, "components") {
		t.Error("TextOutput should contain directory name")
	}
}

func TestListSpecialCharactersInNames(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create files with special characters
	specialNames := []string{
		"file with spaces.txt",
		"file-with-dashes.txt",
		"file_underscores.txt",
		"file.multiple.dots.txt",
	}

	for _, name := range specialNames {
		os.WriteFile(filepath.Join(tmpDir, name), []byte("content"), 0644)
	}

	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(result.Entries) != len(specialNames) {
		t.Errorf("Expected %d entries, got %d", len(specialNames), len(result.Entries))
	}

	// Verify all special names are present
	nameSet := make(map[string]bool)
	for _, entry := range result.Entries {
		nameSet[entry.Name] = true
	}

	for _, name := range specialNames {
		if !nameSet[name] {
			t.Errorf("Missing file with special name: %q", name)
		}
	}
}

func TestListModifiedTime(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_list_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("content"), 0644)

	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(result.Entries) != 1 {
		t.Fatalf("Expected 1 entry, got %d", len(result.Entries))
	}

	// Modified time should be set for files
	if result.Entries[0].Modified == "" {
		t.Error("File should have Modified time set")
	}
}
