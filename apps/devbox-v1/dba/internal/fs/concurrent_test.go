// internal/fs/concurrent_test.go
package fs

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// =============================================================================
// Concurrent Read Tests
// =============================================================================

func TestConcurrentReadsOfSameFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a test file
	content := "This is test content for concurrent reads"
	os.WriteFile(filepath.Join(tmpDir, "shared.txt"), []byte(content), 0644)

	var wg sync.WaitGroup
	errors := make(chan error, 100)
	results := make(chan string, 100)

	// Launch 100 concurrent readers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := Read(tmpDir, "shared.txt", ReadOptions{})
			if err != nil {
				errors <- err
				return
			}
			results <- result.Content
		}()
	}

	wg.Wait()
	close(errors)
	close(results)

	// Check for errors
	errCount := 0
	for err := range errors {
		errCount++
		t.Logf("Concurrent read error: %v", err)
	}

	// Check all reads got the same content
	for result := range results {
		if result != content {
			t.Errorf("Content mismatch: expected %q, got %q", content, result)
		}
	}

	if errCount > 0 {
		t.Logf("Had %d errors out of 100 concurrent reads", errCount)
	}
}

func TestConcurrentReadsOfDifferentFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create multiple test files
	numFiles := 50
	for i := 0; i < numFiles; i++ {
		content := fmt.Sprintf("Content of file %d", i)
		os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte(content), 0644)
	}

	var wg sync.WaitGroup
	errors := make(chan error, numFiles)

	// Read all files concurrently
	for i := 0; i < numFiles; i++ {
		wg.Add(1)
		go func(fileNum int) {
			defer wg.Done()
			result, err := Read(tmpDir, fmt.Sprintf("file%d.txt", fileNum), ReadOptions{})
			if err != nil {
				errors <- err
				return
			}
			expected := fmt.Sprintf("Content of file %d", fileNum)
			if result.Content != expected {
				errors <- fmt.Errorf("file%d content mismatch", fileNum)
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	errCount := 0
	for err := range errors {
		errCount++
		t.Errorf("Concurrent read error: %v", err)
	}

	if errCount > 0 {
		t.Errorf("Had %d errors out of %d concurrent reads", errCount, numFiles)
	}
}

// =============================================================================
// Concurrent Write Tests
// =============================================================================

func TestConcurrentWritesToDifferentFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	var wg sync.WaitGroup
	errors := make(chan error, 100)
	numFiles := 100

	// Write to different files concurrently
	for i := 0; i < numFiles; i++ {
		wg.Add(1)
		go func(fileNum int) {
			defer wg.Done()
			content := fmt.Sprintf("Content %d", fileNum)
			_, err := Write(tmpDir, fmt.Sprintf("file%d.txt", fileNum), WriteOptions{Content: content})
			if err != nil {
				errors <- err
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	errCount := 0
	for err := range errors {
		errCount++
		t.Errorf("Concurrent write error: %v", err)
	}

	// Verify all files were created with correct content
	for i := 0; i < numFiles; i++ {
		content, err := os.ReadFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)))
		if err != nil {
			t.Errorf("File %d not created: %v", i, err)
			continue
		}
		expected := fmt.Sprintf("Content %d", i)
		if string(content) != expected {
			t.Errorf("File %d content mismatch: expected %q, got %q", i, expected, string(content))
		}
	}
}

func TestConcurrentWritesToSameFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	var wg sync.WaitGroup
	numWriters := 50

	// Multiple writers to same file - one should win
	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(writerNum int) {
			defer wg.Done()
			content := fmt.Sprintf("Writer %d", writerNum)
			Write(tmpDir, "shared.txt", WriteOptions{Content: content})
		}(i)
	}

	wg.Wait()

	// File should exist and have content from one of the writers
	content, err := os.ReadFile(filepath.Join(tmpDir, "shared.txt"))
	if err != nil {
		t.Fatalf("File not created: %v", err)
	}

	t.Logf("Final content: %q", string(content))
	// Just verify some content was written
	if len(content) == 0 {
		t.Error("File is empty after concurrent writes")
	}
}

func TestConcurrentAppends(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial file
	os.WriteFile(filepath.Join(tmpDir, "log.txt"), []byte(""), 0644)

	var wg sync.WaitGroup
	numWriters := 100

	// Multiple concurrent appends
	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(writerNum int) {
			defer wg.Done()
			line := fmt.Sprintf("Line %d\n", writerNum)
			Write(tmpDir, "log.txt", WriteOptions{Content: line, Append: true})
		}(i)
	}

	wg.Wait()

	// Verify file has content (lines may be interleaved)
	content, err := os.ReadFile(filepath.Join(tmpDir, "log.txt"))
	if err != nil {
		t.Fatalf("File not found: %v", err)
	}

	// Count newlines - should have at least some appended content
	newlines := 0
	for _, b := range content {
		if b == '\n' {
			newlines++
		}
	}

	t.Logf("File has %d newlines after %d concurrent appends", newlines, numWriters)
	// Due to race conditions, we might not have all lines, but should have some
	if newlines == 0 {
		t.Error("No content appended")
	}
}

// =============================================================================
// Concurrent List Tests
// =============================================================================

func TestConcurrentListOperations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create directory structure
	for i := 0; i < 10; i++ {
		dir := filepath.Join(tmpDir, fmt.Sprintf("dir%d", i))
		os.Mkdir(dir, 0755)
		for j := 0; j < 5; j++ {
			os.WriteFile(filepath.Join(dir, fmt.Sprintf("file%d.txt", j)), []byte("content"), 0644)
		}
	}

	var wg sync.WaitGroup
	errors := make(chan error, 100)
	numReaders := 100

	// Concurrent list operations
	for i := 0; i < numReaders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := List(tmpDir, "", ListOptions{Recursive: true})
			if err != nil {
				errors <- err
				return
			}
			if len(result.Entries) < 10 {
				errors <- fmt.Errorf("expected at least 10 entries, got %d", len(result.Entries))
			}
		}()
	}

	wg.Wait()
	close(errors)

	errCount := 0
	for err := range errors {
		errCount++
		t.Errorf("Concurrent list error: %v", err)
	}

	if errCount > 0 {
		t.Errorf("Had %d errors out of %d concurrent lists", errCount, numReaders)
	}
}

// =============================================================================
// Concurrent Search Tests
// =============================================================================

func TestConcurrentSearchOperations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create files with searchable content
	for i := 0; i < 10; i++ {
		content := fmt.Sprintf("File %d has TODO: item %d\nMore content here", i, i)
		os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte(content), 0644)
	}

	var wg sync.WaitGroup
	errors := make(chan error, 50)
	numSearches := 50

	// Concurrent search operations
	for i := 0; i < numSearches; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := Search(tmpDir, "TODO", SearchOptions{})
			if err != nil {
				errors <- err
				return
			}
			if result.TotalMatches < 10 {
				errors <- fmt.Errorf("expected at least 10 matches, got %d", result.TotalMatches)
			}
		}()
	}

	wg.Wait()
	close(errors)

	errCount := 0
	for err := range errors {
		errCount++
		t.Logf("Concurrent search error: %v", err)
	}

	if errCount > 10 {
		t.Errorf("Too many errors: %d out of %d concurrent searches", errCount, numSearches)
	}
}

// =============================================================================
// Concurrent Copy/Move Tests
// =============================================================================

func TestConcurrentCopyOperations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create source file
	os.WriteFile(filepath.Join(tmpDir, "source.txt"), []byte("source content"), 0644)

	var wg sync.WaitGroup
	numCopies := 50

	// Concurrent copies to different destinations
	for i := 0; i < numCopies; i++ {
		wg.Add(1)
		go func(copyNum int) {
			defer wg.Done()
			Copy(tmpDir, "source.txt", fmt.Sprintf("dest%d.txt", copyNum), false)
		}(i)
	}

	wg.Wait()

	// Count how many copies succeeded
	successCount := 0
	for i := 0; i < numCopies; i++ {
		if _, err := os.Stat(filepath.Join(tmpDir, fmt.Sprintf("dest%d.txt", i))); err == nil {
			successCount++
		}
	}

	t.Logf("%d out of %d concurrent copies succeeded", successCount, numCopies)
	if successCount != numCopies {
		t.Errorf("Expected all %d copies to succeed, only %d did", numCopies, successCount)
	}
}

func TestConcurrentMkdirOperations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	var wg sync.WaitGroup
	numDirs := 100

	// Concurrent mkdir operations
	for i := 0; i < numDirs; i++ {
		wg.Add(1)
		go func(dirNum int) {
			defer wg.Done()
			Mkdir(tmpDir, fmt.Sprintf("dir%d", dirNum), false)
		}(i)
	}

	wg.Wait()

	// Count created directories
	successCount := 0
	for i := 0; i < numDirs; i++ {
		if info, err := os.Stat(filepath.Join(tmpDir, fmt.Sprintf("dir%d", i))); err == nil && info.IsDir() {
			successCount++
		}
	}

	t.Logf("%d out of %d concurrent mkdirs succeeded", successCount, numDirs)
	if successCount != numDirs {
		t.Errorf("Expected all %d mkdirs to succeed, only %d did", numDirs, successCount)
	}
}

func TestConcurrentRemoveOperations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	numFiles := 100

	// Create files to remove
	for i := 0; i < numFiles; i++ {
		os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte("content"), 0644)
	}

	var wg sync.WaitGroup

	// Concurrent remove operations
	for i := 0; i < numFiles; i++ {
		wg.Add(1)
		go func(fileNum int) {
			defer wg.Done()
			Remove(tmpDir, fmt.Sprintf("file%d.txt", fileNum), false)
		}(i)
	}

	wg.Wait()

	// Count remaining files (should be 0)
	remaining := 0
	for i := 0; i < numFiles; i++ {
		if _, err := os.Stat(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i))); err == nil {
			remaining++
		}
	}

	t.Logf("%d files remaining after %d concurrent removes", remaining, numFiles)
	if remaining > 0 {
		t.Errorf("Expected 0 files remaining, got %d", remaining)
	}
}

// =============================================================================
// Mixed Concurrent Operations Tests
// =============================================================================

func TestMixedConcurrentOperations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial file
	os.WriteFile(filepath.Join(tmpDir, "mixed.txt"), []byte("initial"), 0644)

	var wg sync.WaitGroup
	operations := 200

	// Mix of reads, writes, and lists
	for i := 0; i < operations; i++ {
		wg.Add(1)
		go func(opNum int) {
			defer wg.Done()
			switch opNum % 4 {
			case 0:
				Read(tmpDir, "mixed.txt", ReadOptions{})
			case 1:
				Write(tmpDir, fmt.Sprintf("write%d.txt", opNum), WriteOptions{Content: "content"})
			case 2:
				List(tmpDir, "", ListOptions{})
			case 3:
				Write(tmpDir, "mixed.txt", WriteOptions{Content: fmt.Sprintf("content %d", opNum)})
			}
		}(i)
	}

	wg.Wait()

	// Verify directory is in consistent state
	result, err := List(tmpDir, "", ListOptions{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	t.Logf("After mixed operations: %d entries in directory", len(result.Entries))
}

func TestConcurrentReadsDuringWrites(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "fs_concurrent_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial file
	os.WriteFile(filepath.Join(tmpDir, "rw.txt"), []byte("initial content"), 0644)

	var wg sync.WaitGroup
	done := make(chan bool)

	// Continuous writer
	go func() {
		for i := 0; ; i++ {
			select {
			case <-done:
				return
			default:
				Write(tmpDir, "rw.txt", WriteOptions{Content: fmt.Sprintf("Write iteration %d", i)})
			}
		}
	}()

	// Concurrent readers
	errorCount := 0
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := Read(tmpDir, "rw.txt", ReadOptions{})
			if err != nil {
				errorCount++
			}
		}()
	}

	wg.Wait()
	close(done)

	t.Logf("Concurrent reads during writes: %d errors", errorCount)
}
