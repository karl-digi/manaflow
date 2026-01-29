// internal/lsp/refactor.go
package lsp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// RenameResult is the result of renaming a symbol
type RenameResult struct {
	OldName       string         `json:"old_name"`
	NewName       string         `json:"new_name"`
	Changes       []RenameChange `json:"changes"`
	FilesAffected int            `json:"files_affected"`
	TotalChanges  int            `json:"total_changes"`
	Applied       bool           `json:"applied"`
}

// RenameChange represents a single rename change
type RenameChange struct {
	File string `json:"file"`
	Line int    `json:"line"`
	Old  string `json:"old"`
	New  string `json:"new"`
}

// FormatResult is the result of formatting a file
type FormatResult struct {
	Formatted        []string `json:"formatted"`
	AlreadyFormatted []string `json:"already_formatted"`
	Errors           []string `json:"errors,omitempty"`
}

// TextOutput returns human-readable output for rename result
func (r *RenameResult) TextOutput() string {
	var output strings.Builder
	output.WriteString(fmt.Sprintf("Rename '%s' -> '%s'\n", r.OldName, r.NewName))
	output.WriteString(fmt.Sprintf("Files affected: %d\n", r.FilesAffected))
	output.WriteString(fmt.Sprintf("Total changes: %d\n", r.TotalChanges))

	if len(r.Changes) > 0 && len(r.Changes) <= 20 {
		output.WriteString("\nChanges:\n")
		for _, change := range r.Changes {
			output.WriteString(fmt.Sprintf("  %s:%d\n", change.File, change.Line))
		}
	}

	if r.Applied {
		output.WriteString("\nChanges applied successfully")
	} else {
		output.WriteString("\nDry run - use without --dry-run to apply changes")
	}
	return output.String()
}

// TextOutput returns human-readable output for format result
func (r *FormatResult) TextOutput() string {
	var output strings.Builder

	if len(r.Formatted) > 0 {
		output.WriteString("Formatted:\n")
		for _, f := range r.Formatted {
			output.WriteString(fmt.Sprintf("  %s\n", f))
		}
	}

	if len(r.AlreadyFormatted) > 0 {
		output.WriteString("Already formatted:\n")
		for _, f := range r.AlreadyFormatted {
			output.WriteString(fmt.Sprintf("  %s\n", f))
		}
	}

	if len(r.Errors) > 0 {
		output.WriteString("Errors:\n")
		for _, e := range r.Errors {
			output.WriteString(fmt.Sprintf("  %s\n", e))
		}
	}

	return output.String()
}

// RenameSymbol renames a symbol across the codebase
func RenameSymbol(ctx context.Context, projectPath, file string, line, col int, newName string, dryRun bool) (*RenameResult, error) {
	fullPath := filepath.Join(projectPath, file)
	symbol, err := getSymbolAtPosition(fullPath, line, col)
	if err != nil {
		return nil, err
	}

	result := &RenameResult{
		OldName: symbol,
		NewName: newName,
		Changes: []RenameChange{},
	}

	// Find all references
	refs, err := GetReferences(ctx, projectPath, file, line, col, true)
	if err != nil {
		return nil, err
	}

	files := make(map[string]bool)
	for _, ref := range refs.References {
		files[ref.File] = true
		result.Changes = append(result.Changes, RenameChange{
			File: ref.File,
			Line: ref.Line,
			Old:  symbol,
			New:  newName,
		})
	}

	result.FilesAffected = len(files)
	result.TotalChanges = len(result.Changes)

	if !dryRun {
		// Apply changes using sed
		for file := range files {
			fullFilePath := filepath.Join(projectPath, file)

			// Read file content
			content, err := os.ReadFile(fullFilePath)
			if err != nil {
				continue
			}

			// Replace all occurrences of the symbol with word boundaries
			// This is a simple replacement - a real implementation would
			// be more sophisticated to handle different contexts
			newContent := replaceWord(string(content), symbol, newName)

			// Write back
			if newContent != string(content) {
				err = os.WriteFile(fullFilePath, []byte(newContent), 0644)
				if err != nil {
					continue
				}
			}
		}
		result.Applied = true
	}

	return result, nil
}

// replaceWord replaces a word in content respecting word boundaries
func replaceWord(content, oldWord, newWord string) string {
	// Simple word boundary replacement
	// In a real implementation, we'd use a more sophisticated approach
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		lines[i] = replaceWordInLine(line, oldWord, newWord)
	}
	return strings.Join(lines, "\n")
}

func replaceWordInLine(line, oldWord, newWord string) string {
	result := ""
	remaining := line

	for {
		idx := strings.Index(remaining, oldWord)
		if idx == -1 {
			result += remaining
			break
		}

		// Check word boundaries
		isStartBoundary := idx == 0 || !isWordChar(remaining[idx-1])
		endIdx := idx + len(oldWord)
		isEndBoundary := endIdx >= len(remaining) || !isWordChar(remaining[endIdx])

		if isStartBoundary && isEndBoundary {
			result += remaining[:idx] + newWord
		} else {
			result += remaining[:idx+len(oldWord)]
		}
		remaining = remaining[endIdx:]
	}

	return result
}

// FormatFile formats a file using the appropriate formatter
func FormatFile(ctx context.Context, projectPath string, files []string, checkOnly bool) (*FormatResult, error) {
	result := &FormatResult{
		Formatted:        []string{},
		AlreadyFormatted: []string{},
		Errors:           []string{},
	}

	// Detect formatter
	formatter := detectFormatter(projectPath)

	// If no specific files, format all
	if len(files) == 0 || (len(files) == 1 && files[0] == ".") {
		files = []string{"."}
	}

	for _, file := range files {
		fullPath := file
		if !filepath.IsAbs(file) && file != "." {
			fullPath = filepath.Join(projectPath, file)
		} else if file == "." {
			fullPath = projectPath
		}

		var cmd *exec.Cmd
		switch formatter {
		case "prettier":
			if checkOnly {
				cmd = exec.CommandContext(ctx, "npx", "prettier", "--check", fullPath)
			} else {
				cmd = exec.CommandContext(ctx, "npx", "prettier", "--write", fullPath)
			}
		case "gofmt":
			if checkOnly {
				cmd = exec.CommandContext(ctx, "gofmt", "-l", fullPath)
			} else {
				cmd = exec.CommandContext(ctx, "gofmt", "-w", fullPath)
			}
		case "black":
			if checkOnly {
				cmd = exec.CommandContext(ctx, "black", "--check", fullPath)
			} else {
				cmd = exec.CommandContext(ctx, "black", fullPath)
			}
		case "rustfmt":
			if checkOnly {
				cmd = exec.CommandContext(ctx, "rustfmt", "--check", fullPath)
			} else {
				cmd = exec.CommandContext(ctx, "rustfmt", fullPath)
			}
		default:
			result.Errors = append(result.Errors, fmt.Sprintf("no formatter available for %s", file))
			continue
		}

		cmd.Dir = projectPath
		err := cmd.Run()

		if checkOnly {
			if err != nil {
				result.Formatted = append(result.Formatted, file) // Needs formatting
			} else {
				result.AlreadyFormatted = append(result.AlreadyFormatted, file)
			}
		} else {
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("failed to format %s: %v", file, err))
			} else {
				result.Formatted = append(result.Formatted, file)
			}
		}
	}

	return result, nil
}

func detectFormatter(projectPath string) string {
	// Check for prettier
	prettierConfigs := []string{
		".prettierrc",
		".prettierrc.json",
		".prettierrc.js",
		".prettierrc.cjs",
		".prettierrc.mjs",
		".prettierrc.yml",
		".prettierrc.yaml",
		"prettier.config.js",
		"prettier.config.cjs",
		"prettier.config.mjs",
	}
	for _, cfg := range prettierConfigs {
		if _, err := os.Stat(filepath.Join(projectPath, cfg)); err == nil {
			return "prettier"
		}
	}

	// Check package.json for prettier
	pkgPath := filepath.Join(projectPath, "package.json")
	if _, err := os.Stat(pkgPath); err == nil {
		// Assume JavaScript/TypeScript projects use prettier
		return "prettier"
	}

	// Check for Go
	if _, err := os.Stat(filepath.Join(projectPath, "go.mod")); err == nil {
		return "gofmt"
	}

	// Check for Python
	if _, err := os.Stat(filepath.Join(projectPath, "pyproject.toml")); err == nil {
		return "black"
	}
	if _, err := os.Stat(filepath.Join(projectPath, "setup.py")); err == nil {
		return "black"
	}

	// Check for Rust
	if _, err := os.Stat(filepath.Join(projectPath, "Cargo.toml")); err == nil {
		return "rustfmt"
	}

	return "prettier" // Default
}
