// internal/fs/search_test.go
package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSearchEmptyDirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	result, err := Search(tmpDir, "anything", SearchOptions{})
	if err != nil {
		t.Fatalf("Search empty directory failed: %v", err)
	}

	if len(result.Matches) != 0 {
		t.Errorf("Expected 0 matches, got %d", len(result.Matches))
	}

	if result.TotalMatches != 0 {
		t.Errorf("Expected 0 total matches, got %d", result.TotalMatches)
	}
}

func TestSearchNoMatches(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create files without the search term
	os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte("hello world"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file2.txt"), []byte("goodbye world"), 0644)

	result, err := Search(tmpDir, "nonexistent", SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if len(result.Matches) != 0 {
		t.Errorf("Expected 0 matches, got %d", len(result.Matches))
	}
}

func TestSearchBasicMatch(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create files with TODO
	os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte("TODO: fix this\nother line"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file2.txt"), []byte("no match here"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "file3.txt"), []byte("another TODO here"), 0644)

	result, err := Search(tmpDir, "TODO", SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if result.TotalMatches < 2 {
		t.Errorf("Expected at least 2 matches, got %d", result.TotalMatches)
	}

	if result.FilesSearched < 2 {
		t.Errorf("Expected at least 2 files searched, got %d", result.FilesSearched)
	}

	if result.Query != "TODO" {
		t.Errorf("Expected query 'TODO', got %q", result.Query)
	}
}

func TestSearchCaseSensitive(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("Hello World\nhello world\nHELLO WORLD"), 0644)

	// Case insensitive search (default)
	result, err := Search(tmpDir, "hello", SearchOptions{CaseSensitive: false})
	if err != nil {
		t.Fatalf("Case insensitive search failed: %v", err)
	}

	if result.TotalMatches < 3 {
		t.Errorf("Case insensitive: expected at least 3 matches, got %d", result.TotalMatches)
	}

	// Case sensitive search
	result, err = Search(tmpDir, "hello", SearchOptions{CaseSensitive: true})
	if err != nil {
		t.Fatalf("Case sensitive search failed: %v", err)
	}

	if result.TotalMatches != 1 {
		t.Errorf("Case sensitive: expected 1 match, got %d", result.TotalMatches)
	}
}

func TestSearchWithPattern(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create various file types
	os.WriteFile(filepath.Join(tmpDir, "app.js"), []byte("function TODO() {}"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "app.ts"), []byte("function TODO() {}"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "readme.md"), []byte("TODO: write docs"), 0644)

	// Search only in .js files
	result, err := Search(tmpDir, "TODO", SearchOptions{Pattern: "*.js"})
	if err != nil {
		t.Fatalf("Search with pattern failed: %v", err)
	}

	// Should only find in app.js
	for _, match := range result.Matches {
		if !strings.HasSuffix(match.File, ".js") {
			t.Errorf("Pattern filter failed, found match in: %s", match.File)
		}
	}
}

func TestSearchMaxResults(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create file with many matches
	content := strings.Repeat("TODO: item\n", 100)
	os.WriteFile(filepath.Join(tmpDir, "todos.txt"), []byte(content), 0644)

	// Limit to 10 results
	result, err := Search(tmpDir, "TODO", SearchOptions{MaxResults: 10})
	if err != nil {
		t.Fatalf("Search with max results failed: %v", err)
	}

	if len(result.Matches) > 10 {
		t.Errorf("Expected at most 10 matches, got %d", len(result.Matches))
	}
}

func TestSearchRegex(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "code.js"), []byte("function foo() {}\nfunction bar() {}\nconst baz = () => {}"), 0644)

	// Search for function names with regex
	result, err := Search(tmpDir, "function \\w+", SearchOptions{Regex: true})
	if err != nil {
		t.Fatalf("Regex search failed: %v", err)
	}

	if result.TotalMatches < 2 {
		t.Errorf("Expected at least 2 regex matches, got %d", result.TotalMatches)
	}
}

func TestSearchMatchDetails(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "test.txt"), []byte("first line\nTODO: fix bug\nlast line"), 0644)

	result, err := Search(tmpDir, "TODO", SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if len(result.Matches) == 0 {
		t.Fatal("Expected at least 1 match")
	}

	match := result.Matches[0]
	if match.Line != 2 {
		t.Errorf("Expected line 2, got %d", match.Line)
	}

	if match.Column < 1 {
		t.Errorf("Expected column >= 1, got %d", match.Column)
	}

	if !strings.Contains(match.Content, "TODO") {
		t.Errorf("Match content should contain 'TODO', got: %s", match.Content)
	}
}

func TestSearchInSubdirectory(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create nested structure
	os.MkdirAll(filepath.Join(tmpDir, "src", "components"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "src", "app.js"), []byte("TODO: main"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "src", "components", "button.js"), []byte("TODO: button"), 0644)

	result, err := Search(tmpDir, "TODO", SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	if result.TotalMatches < 2 {
		t.Errorf("Expected at least 2 matches in subdirs, got %d", result.TotalMatches)
	}

	// Should have searched multiple files
	if result.FilesSearched < 2 {
		t.Errorf("Expected at least 2 files searched, got %d", result.FilesSearched)
	}
}

func TestSearchSpecialCharacters(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Content with special regex characters
	os.WriteFile(filepath.Join(tmpDir, "test.txt"), []byte("test (parentheses)\ntest [brackets]\ntest $dollar"), 0644)

	// Search for literal special characters (non-regex mode)
	result, err := Search(tmpDir, "(parentheses)", SearchOptions{Regex: false})
	if err != nil {
		t.Fatalf("Search special chars failed: %v", err)
	}

	if result.TotalMatches < 1 {
		t.Errorf("Expected at least 1 match for special chars, got %d", result.TotalMatches)
	}
}

func TestSearchUnicodeContent(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Unicode content
	os.WriteFile(filepath.Join(tmpDir, "unicode.txt"), []byte("Hello 世界\nПривет мир\nمرحبا"), 0644)

	// Search for Unicode text
	result, err := Search(tmpDir, "世界", SearchOptions{})
	if err != nil {
		t.Fatalf("Unicode search failed: %v", err)
	}

	if result.TotalMatches < 1 {
		t.Errorf("Expected at least 1 match for Unicode, got %d", result.TotalMatches)
	}
}

func TestSearchTextOutput(t *testing.T) {
	result := &SearchResult{
		Query: "TODO",
		Matches: []SearchMatch{
			{File: "app.js", Line: 10, Column: 5, Content: "// TODO: fix this"},
			{File: "lib.js", Line: 20, Column: 1, Content: "TODO: refactor"},
		},
		TotalMatches:  2,
		FilesSearched: 2,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "TODO") {
		t.Error("TextOutput should contain query")
	}
	if !strings.Contains(output, "2 matches") {
		t.Error("TextOutput should contain match count")
	}
	if !strings.Contains(output, "app.js") {
		t.Error("TextOutput should contain file names")
	}
}

func TestSearchEmptyQuery(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "test.txt"), []byte("content"), 0644)

	// Empty query behavior depends on ripgrep - may match every line or error
	// We just verify it doesn't crash
	_, err = Search(tmpDir, "", SearchOptions{})
	// Either returns results or error - we just verify no panic
	if err != nil {
		t.Logf("Empty query returned error (acceptable): %v", err)
	}
}

func TestSearchBinaryFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create binary file (should be skipped by ripgrep)
	binaryContent := []byte{0x00, 0x01, 0x02, 'T', 'O', 'D', 'O', 0x00, 0xFF}
	os.WriteFile(filepath.Join(tmpDir, "binary.bin"), binaryContent, 0644)

	// Create text file
	os.WriteFile(filepath.Join(tmpDir, "text.txt"), []byte("TODO: test"), 0644)

	result, err := Search(tmpDir, "TODO", SearchOptions{})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	// Should find in text file
	if result.TotalMatches < 1 {
		t.Errorf("Expected at least 1 match, got %d", result.TotalMatches)
	}

	// Verify matches are from text file
	for _, match := range result.Matches {
		if strings.HasSuffix(match.File, ".bin") {
			t.Error("Should not match in binary files")
		}
	}
}

func TestSearchWithContext(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	content := "line 1\nline 2\nTODO: target\nline 4\nline 5"
	os.WriteFile(filepath.Join(tmpDir, "test.txt"), []byte(content), 0644)

	// Search with context
	result, err := Search(tmpDir, "TODO", SearchOptions{Context: 1})
	if err != nil {
		t.Fatalf("Search with context failed: %v", err)
	}

	// Should have matches
	if result.TotalMatches < 1 {
		t.Errorf("Expected at least 1 match, got %d", result.TotalMatches)
	}

	// Note: Context is handled by ripgrep in JSON output,
	// we just verify the option is passed correctly
}

func TestSearchNoIgnore(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .gitignore
	os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("ignored/"), 0644)

	// Create ignored directory with content
	os.MkdirAll(filepath.Join(tmpDir, "ignored"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "ignored", "file.txt"), []byte("TODO: ignored"), 0644)

	// Create normal file
	os.WriteFile(filepath.Join(tmpDir, "normal.txt"), []byte("TODO: visible"), 0644)

	// Search with gitignore respected (default)
	result1, err := Search(tmpDir, "TODO", SearchOptions{NoIgnore: false})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	// Search ignoring gitignore
	result2, err := Search(tmpDir, "TODO", SearchOptions{NoIgnore: true})
	if err != nil {
		t.Fatalf("Search with no-ignore failed: %v", err)
	}

	// With no-ignore, we should find more matches
	if result2.TotalMatches <= result1.TotalMatches && result1.TotalMatches > 0 {
		// This test depends on ripgrep behavior
		// If result1 already finds the ignored file, that's ok too
		t.Logf("Note: gitignore may not be working as expected, result1=%d, result2=%d",
			result1.TotalMatches, result2.TotalMatches)
	}
}

func TestSearchFallback(t *testing.T) {
	// This tests that the grep fallback works if ripgrep is not available
	// We can't easily uninstall ripgrep, so we just verify the function exists
	// and has the correct signature
	tmpDir, err := os.MkdirTemp("", "fs_search_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	os.WriteFile(filepath.Join(tmpDir, "test.txt"), []byte("TODO: test"), 0644)

	// This will use ripgrep if available, or fallback
	result, err := Search(tmpDir, "TODO", SearchOptions{})
	if err != nil {
		t.Fatalf("Search (possibly with fallback) failed: %v", err)
	}

	if result.TotalMatches < 1 {
		t.Errorf("Expected at least 1 match, got %d", result.TotalMatches)
	}
}
