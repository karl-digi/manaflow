// internal/lsp/navigation.go
package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Location represents a code location
type Location struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview,omitempty"`
}

// DefinitionResult is the result of go to definition
type DefinitionResult struct {
	Symbol     string    `json:"symbol"`
	Location   string    `json:"location"`
	Definition *Location `json:"definition,omitempty"`
	Type       string    `json:"type,omitempty"`
}

// ReferencesResult is the result of find references
type ReferencesResult struct {
	Symbol     string     `json:"symbol"`
	References []Location `json:"references"`
	Total      int        `json:"total"`
}

// HoverResult is the result of hover information
type HoverResult struct {
	Symbol        string `json:"symbol"`
	Type          string `json:"type,omitempty"`
	Documentation string `json:"documentation,omitempty"`
}

// TextOutput returns human-readable output for definition result
func (r *DefinitionResult) TextOutput() string {
	if r.Definition == nil {
		return fmt.Sprintf("No definition found for '%s' at %s", r.Symbol, r.Location)
	}
	output := fmt.Sprintf("Definition of '%s':\n", r.Symbol)
	output += fmt.Sprintf("  %s:%d:%d\n", r.Definition.File, r.Definition.Line, r.Definition.Column)
	if r.Definition.Preview != "" {
		output += fmt.Sprintf("  %s\n", r.Definition.Preview)
	}
	if r.Type != "" {
		output += fmt.Sprintf("  Type: %s\n", r.Type)
	}
	return output
}

// TextOutput returns human-readable output for references result
func (r *ReferencesResult) TextOutput() string {
	if len(r.References) == 0 {
		return fmt.Sprintf("No references found for '%s'", r.Symbol)
	}
	var output strings.Builder
	output.WriteString(fmt.Sprintf("Found %d references to '%s':\n", r.Total, r.Symbol))
	for _, ref := range r.References {
		output.WriteString(fmt.Sprintf("  %s:%d:%d\n", ref.File, ref.Line, ref.Column))
		if ref.Preview != "" {
			output.WriteString(fmt.Sprintf("    %s\n", ref.Preview))
		}
	}
	return output.String()
}

// TextOutput returns human-readable output for hover result
func (r *HoverResult) TextOutput() string {
	var output strings.Builder
	output.WriteString(fmt.Sprintf("Symbol: %s\n", r.Symbol))
	if r.Type != "" {
		output.WriteString(fmt.Sprintf("Type: %s\n", r.Type))
	}
	if r.Documentation != "" {
		output.WriteString(fmt.Sprintf("Documentation: %s\n", r.Documentation))
	}
	return output.String()
}

// GetDefinition finds the definition of a symbol
func GetDefinition(ctx context.Context, projectPath, file string, line, col int) (*DefinitionResult, error) {
	// Read the file and get the symbol at the position
	fullPath := filepath.Join(projectPath, file)
	symbol, err := getSymbolAtPosition(fullPath, line, col)
	if err != nil {
		return nil, err
	}

	result := &DefinitionResult{
		Symbol:   symbol,
		Location: fmt.Sprintf("%s:%d:%d", file, line, col),
	}

	// Search for definition in project
	searchResult, err := SearchSymbols(ctx, projectPath, symbol, true)
	if err != nil {
		return result, nil
	}

	if len(searchResult.Symbols) > 0 {
		sym := searchResult.Symbols[0]
		result.Definition = &Location{
			File:    sym.File,
			Line:    sym.Line,
			Column:  1,
			Preview: sym.Content,
		}
		result.Type = sym.Kind
	}

	return result, nil
}

// GetReferences finds all references to a symbol
func GetReferences(ctx context.Context, projectPath, file string, line, col int, includeDeclaration bool) (*ReferencesResult, error) {
	fullPath := filepath.Join(projectPath, file)
	symbol, err := getSymbolAtPosition(fullPath, line, col)
	if err != nil {
		return nil, err
	}

	result := &ReferencesResult{
		Symbol:     symbol,
		References: []Location{},
	}

	// Use ripgrep to find all references
	args := []string{
		"--json",
		"-w", // Word boundary
		symbol,
		"--type", "ts",
		"--type", "js",
		"--type-add", "tsx:*.tsx",
		"--type-add", "jsx:*.jsx",
		"--type", "tsx",
		"--type", "jsx",
	}

	cmd := exec.CommandContext(ctx, "rg", args...)
	cmd.Dir = projectPath

	output, _ := cmd.Output()

	// Parse ripgrep output
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		var msg RipgrepMessage
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}

		if msg.Type != "match" {
			continue
		}

		if msg.Data == nil {
			continue
		}

		pathText := ""
		if msg.Data.Path != nil {
			pathText = msg.Data.Path.Text
		}

		contentText := ""
		if msg.Data.Lines != nil {
			contentText = strings.TrimSpace(msg.Data.Lines.Text)
		}

		loc := Location{
			File:    pathText,
			Line:    int(msg.Data.LineNumber),
			Column:  1,
			Preview: contentText,
		}

		result.References = append(result.References, loc)
	}

	result.Total = len(result.References)
	return result, nil
}

// GetHover returns hover information for a symbol
func GetHover(ctx context.Context, projectPath, file string, line, col int) (*HoverResult, error) {
	fullPath := filepath.Join(projectPath, file)
	symbol, err := getSymbolAtPosition(fullPath, line, col)
	if err != nil {
		return nil, err
	}

	result := &HoverResult{
		Symbol: symbol,
	}

	// Try to find the definition to get type info
	defResult, err := GetDefinition(ctx, projectPath, file, line, col)
	if err == nil && defResult.Definition != nil {
		result.Type = defResult.Type
		result.Documentation = defResult.Definition.Preview
	}

	return result, nil
}

func getSymbolAtPosition(filePath string, line, col int) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	currentLine := 0

	for scanner.Scan() {
		currentLine++
		if currentLine == line {
			text := scanner.Text()

			// Find word at column
			if col > len(text) {
				col = len(text)
			}
			if col <= 0 {
				col = 1
			}

			// Find word boundaries
			start := col - 1
			end := col - 1

			for start > 0 && isWordChar(text[start-1]) {
				start--
			}
			for end < len(text) && isWordChar(text[end]) {
				end++
			}

			if start < end {
				return text[start:end], nil
			}
			break
		}
	}

	return "", fmt.Errorf("could not find symbol at position %d:%d", line, col)
}

func isWordChar(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$'
}
