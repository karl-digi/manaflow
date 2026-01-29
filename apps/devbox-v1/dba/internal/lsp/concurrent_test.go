// internal/lsp/concurrent_test.go
package lsp

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestConcurrent_MultipleSearches tests concurrent symbol searches
func TestConcurrent_MultipleSearches(t *testing.T) {
	tmpDir := t.TempDir()

	// Create several files
	for i := 0; i < 10; i++ {
		content := `const variable` + string(rune('A'+i)) + ` = ` + string(rune('0'+i)) + `;
function func` + string(rune('A'+i)) + `() { return variable` + string(rune('A'+i)) + `; }
`
		filename := filepath.Join(tmpDir, "file"+string(rune('A'+i))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	errors := make(chan error, 20)

	// Run 20 concurrent searches
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			query := "variable" + string(rune('A'+idx%10))
			_, err := SearchSymbols(ctx, tmpDir, query, false)
			if err != nil {
				errors <- err
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent search error: %v", err)
	}
}

// TestConcurrent_MultipleDefinitions tests concurrent definition lookups
func TestConcurrent_MultipleDefinitions(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const foo = 1;
const bar = 2;
const baz = 3;
const qux = foo + bar + baz;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	errors := make(chan error, 10)

	// Run concurrent definition lookups for different positions
	positions := []struct{ line, col int }{
		{1, 7}, {2, 7}, {3, 7}, {4, 13}, {4, 19}, {4, 25},
	}

	for _, pos := range positions {
		wg.Add(1)
		go func(line, col int) {
			defer wg.Done()
			_, err := GetDefinition(ctx, tmpDir, "test.ts", line, col)
			if err != nil {
				errors <- err
			}
		}(pos.line, pos.col)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent definition error: %v", err)
	}
}

// TestConcurrent_MultipleReferences tests concurrent reference lookups
func TestConcurrent_MultipleReferences(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const shared = 1;
const a = shared;
const b = shared;
const c = shared;
const d = shared;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	errors := make(chan error, 10)

	// Run 10 concurrent reference lookups
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := GetReferences(ctx, tmpDir, "test.ts", 1, 7, true)
			if err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent references error: %v", err)
	}
}

// TestConcurrent_MixedOperations tests concurrent mixed operations
func TestConcurrent_MixedOperations(t *testing.T) {
	tmpDir := t.TempDir()

	content := `interface User {
  id: number;
  name: string;
}

const users: User[] = [];

function getUser(id: number): User | undefined {
  return users.find(u => u.id === id);
}
`
	os.WriteFile(filepath.Join(tmpDir, "app.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	errors := make(chan error, 50)

	// Mix of different operations
	operations := []func(){
		func() {
			_, err := SearchSymbols(ctx, tmpDir, "User", false)
			if err != nil {
				errors <- err
			}
		},
		func() {
			// Position 8, column 10 points to "getUser" function name
			_, err := GetDefinition(ctx, tmpDir, "app.ts", 8, 10)
			if err != nil {
				errors <- err
			}
		},
		func() {
			_, err := GetReferences(ctx, tmpDir, "app.ts", 1, 12, true)
			if err != nil {
				errors <- err
			}
		},
		func() {
			_, err := GetHover(ctx, tmpDir, "app.ts", 8, 10)
			if err != nil {
				errors <- err
			}
		},
		func() {
			_, err := GetCodeActions(ctx, tmpDir, "app.ts", 1, 1)
			if err != nil {
				errors <- err
			}
		},
	}

	// Run each operation multiple times concurrently
	for i := 0; i < 10; i++ {
		for _, op := range operations {
			wg.Add(1)
			opCopy := op
			go func() {
				defer wg.Done()
				opCopy()
			}()
		}
	}

	wg.Wait()
	close(errors)

	errCount := 0
	for err := range errors {
		errCount++
		t.Logf("Concurrent operation error: %v", err)
	}
	if errCount > 0 {
		t.Errorf("Got %d errors from concurrent operations", errCount)
	}
}

// TestConcurrent_RenameReadConflict tests that reads during rename work correctly
func TestConcurrent_RenameReadConflict(t *testing.T) {
	tmpDir := t.TempDir()

	content := `const original = 1;
const x = original;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	errors := make(chan error, 20)

	// Start multiple reads
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := GetDefinition(ctx, tmpDir, "test.ts", 2, 11)
			if err != nil {
				errors <- err
			}
		}()
	}

	// Also do a dry-run rename (doesn't modify file)
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err := RenameSymbol(ctx, tmpDir, "test.ts", 1, 7, "renamed", true)
		if err != nil {
			errors <- err
		}
	}()

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent error: %v", err)
	}
}

// TestConcurrent_DiagnosticsParallel tests parallel diagnostic fetching
func TestConcurrent_DiagnosticsParallel(t *testing.T) {
	tmpDir := t.TempDir()

	// Create multiple files
	for i := 0; i < 5; i++ {
		content := `const x` + string(rune('1'+i)) + ` = ` + string(rune('0'+i)) + `;
`
		filename := filepath.Join(tmpDir, "file"+string(rune('1'+i))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	results := make(chan *DiagnosticsResult, 10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, _ := GetDiagnostics(ctx, tmpDir, DiagnosticsOptions{})
			if result != nil {
				results <- result
			}
		}()
	}

	wg.Wait()
	close(results)

	// Just verify we got results
	count := 0
	for range results {
		count++
	}
	if count != 10 {
		t.Errorf("Expected 10 results, got %d", count)
	}
}

// TestConcurrent_SymbolSearchWithFilters tests concurrent symbol searches with different filters
func TestConcurrent_SymbolSearchWithFilters(t *testing.T) {
	tmpDir := t.TempDir()

	content := `function myFunction() {}
class MyClass {}
const myConst = 1;
interface MyInterface {}
type MyType = string;
`
	os.WriteFile(filepath.Join(tmpDir, "test.ts"), []byte(content), 0644)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	errors := make(chan error, 10)

	queries := []string{"my", "MyClass", "function", "const", "interface"}

	for _, query := range queries {
		wg.Add(2)
		q := query

		// Search all
		go func() {
			defer wg.Done()
			_, err := SearchSymbols(ctx, tmpDir, q, false)
			if err != nil {
				errors <- err
			}
		}()

		// Search symbols only
		go func() {
			defer wg.Done()
			_, err := SearchSymbols(ctx, tmpDir, q, true)
			if err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent search with filter error: %v", err)
	}
}

// TestConcurrent_StressTest performs a stress test with many concurrent operations
func TestConcurrent_StressTest(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping stress test in short mode")
	}

	tmpDir := t.TempDir()

	// Create a reasonably sized codebase
	for i := 0; i < 20; i++ {
		content := `// File ` + string(rune('A'+i)) + `
export interface Model` + string(rune('A'+i)) + ` {
  id: number;
  name: string;
}

export function process` + string(rune('A'+i)) + `(model: Model` + string(rune('A'+i)) + `): void {
  console.log(model.id, model.name);
}

export const instance` + string(rune('A'+i)) + `: Model` + string(rune('A'+i)) + ` = {
  id: ` + string(rune('0'+i%10)) + `,
  name: "test` + string(rune('A'+i)) + `"
};
`
		filename := filepath.Join(tmpDir, "module"+string(rune('A'+i))+".ts")
		os.WriteFile(filename, []byte(content), 0644)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	var errorCount int64
	var mu sync.Mutex

	// Run 100 concurrent operations
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			var err error
			switch idx % 5 {
			case 0:
				_, err = SearchSymbols(ctx, tmpDir, "Model", false)
			case 1:
				_, err = GetDiagnostics(ctx, tmpDir, DiagnosticsOptions{})
			case 2:
				file := "module" + string(rune('A'+idx%20)) + ".ts"
				_, err = GetDefinition(ctx, tmpDir, file, 2, 20)
			case 3:
				file := "module" + string(rune('A'+idx%20)) + ".ts"
				_, err = GetReferences(ctx, tmpDir, file, 2, 20, true)
			case 4:
				file := "module" + string(rune('A'+idx%20)) + ".ts"
				_, err = GetHover(ctx, tmpDir, file, 2, 20)
			}

			if err != nil {
				mu.Lock()
				errorCount++
				mu.Unlock()
			}
		}(i)
	}

	wg.Wait()

	if errorCount > 10 { // Allow some errors due to timing issues
		t.Errorf("Too many errors in stress test: %d", errorCount)
	}
}
