// internal/lsp/symbols.go
package lsp

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// Symbol represents a code symbol
type Symbol struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"` // function, class, variable, etc.
	File    string `json:"file"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Content string `json:"content,omitempty"`
}

// SymbolSearchResult is the result of searching symbols
type SymbolSearchResult struct {
	Query   string   `json:"query"`
	Symbols []Symbol `json:"symbols"`
	Total   int      `json:"total"`
}

// TextOutput returns human-readable output for symbol search
func (r *SymbolSearchResult) TextOutput() string {
	if len(r.Symbols) == 0 {
		return fmt.Sprintf("No symbols found for query: %s", r.Query)
	}

	var output strings.Builder
	output.WriteString(fmt.Sprintf("Found %d symbols for '%s':\n", r.Total, r.Query))
	for _, sym := range r.Symbols {
		output.WriteString(fmt.Sprintf("  %s [%s] at %s:%d\n", sym.Name, sym.Kind, sym.File, sym.Line))
		if sym.Content != "" {
			output.WriteString(fmt.Sprintf("    %s\n", sym.Content))
		}
	}
	return output.String()
}

// SearchSymbols searches for symbols in the codebase
func SearchSymbols(ctx context.Context, projectPath, query string, symbolsOnly bool) (*SymbolSearchResult, error) {
	result := &SymbolSearchResult{
		Query:   query,
		Symbols: []Symbol{},
	}

	// Build ripgrep command for symbol-like patterns
	var pattern string
	if symbolsOnly {
		// Search for definitions (function, class, const, let, var, interface, type)
		pattern = fmt.Sprintf(`(function|class|const|let|var|interface|type|export)\s+%s\b`, regexp.QuoteMeta(query))
	} else {
		pattern = query
	}

	args := []string{
		"--json",
		"-e", pattern,
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

	// Parse ripgrep JSON output
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

		symbol := Symbol{
			Name:    query,
			File:    pathText,
			Line:    int(msg.Data.LineNumber),
			Content: contentText,
		}

		// Try to determine kind from content
		symbol.Kind = detectSymbolKind(symbol.Content)

		result.Symbols = append(result.Symbols, symbol)
	}

	result.Total = len(result.Symbols)
	return result, nil
}

// RipgrepMessage represents a ripgrep JSON output message
type RipgrepMessage struct {
	Type string        `json:"type"`
	Data *RipgrepMatch `json:"data,omitempty"`
}

// RipgrepMatch represents a ripgrep match
type RipgrepMatch struct {
	Path       *RipgrepText `json:"path,omitempty"`
	Lines      *RipgrepText `json:"lines,omitempty"`
	LineNumber float64      `json:"line_number"`
}

// RipgrepText represents text content in ripgrep output
type RipgrepText struct {
	Text string `json:"text"`
}

func detectSymbolKind(content string) string {
	contentLower := strings.ToLower(content)

	switch {
	case strings.Contains(contentLower, "function"):
		return "function"
	case strings.Contains(contentLower, "class"):
		return "class"
	case strings.Contains(contentLower, "interface"):
		return "interface"
	case strings.Contains(contentLower, "type "):
		return "type"
	case strings.Contains(contentLower, "const"):
		return "constant"
	case strings.Contains(contentLower, "let") || strings.Contains(contentLower, "var"):
		return "variable"
	case strings.Contains(contentLower, "export"):
		return "export"
	default:
		return "unknown"
	}
}
