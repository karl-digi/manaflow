// internal/fs/search.go
package fs

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// SearchMatch represents a search match
type SearchMatch struct {
	File    string        `json:"file"`
	Line    int           `json:"line"`
	Column  int           `json:"column"`
	Content string        `json:"content"`
	Context *MatchContext `json:"context,omitempty"`
}

// MatchContext provides surrounding lines for a match
type MatchContext struct {
	Before []string `json:"before,omitempty"`
	After  []string `json:"after,omitempty"`
}

// SearchResult is the result of a search
type SearchResult struct {
	Query         string        `json:"query"`
	Matches       []SearchMatch `json:"matches"`
	TotalMatches  int           `json:"total_matches"`
	FilesSearched int           `json:"files_searched"`
}

// SearchOptions are options for searching
type SearchOptions struct {
	Pattern       string // File pattern (glob)
	Regex         bool   // Treat query as regex
	CaseSensitive bool   // Case sensitive search
	Context       int    // Lines of context
	MaxResults    int    // Max results to return
	NoIgnore      bool   // Don't respect .gitignore
	FollowSymlinks bool  // Follow symlinks during search
}

// Search searches for a pattern in files using ripgrep
func Search(projectPath, query string, opts SearchOptions) (*SearchResult, error) {
	// Check if ripgrep is available
	if _, err := exec.LookPath("rg"); err != nil {
		// Fall back to grep-style search
		return searchFallback(projectPath, query, opts)
	}

	args := []string{
		"--json",
		"--line-number",
		"--column",
	}

	if !opts.CaseSensitive {
		args = append(args, "-i")
	}

	if opts.Regex {
		args = append(args, "-e")
	}

	if opts.Pattern != "" {
		args = append(args, "-g", opts.Pattern)
	}

	// Respect .gitignore by default (ripgrep default), but allow override
	if opts.NoIgnore {
		args = append(args, "--no-ignore")
	}

	// Follow symlinks if requested
	if opts.FollowSymlinks {
		args = append(args, "-L")
	}

	if opts.Context > 0 {
		args = append(args, "-C", strconv.Itoa(opts.Context))
	}

	if opts.MaxResults > 0 {
		args = append(args, "-m", strconv.Itoa(opts.MaxResults))
	}

	args = append(args, query, ".")

	cmd := exec.Command("rg", args...)
	cmd.Dir = projectPath

	output, _ := cmd.Output() // rg returns non-zero if no matches

	return parseRipgrepOutput(query, output)
}

func parseRipgrepOutput(query string, output []byte) (*SearchResult, error) {
	result := &SearchResult{
		Query:   query,
		Matches: []SearchMatch{},
	}

	filesSearched := make(map[string]bool)

	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var msg map[string]interface{}
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}

		msgType, _ := msg["type"].(string)

		switch msgType {
		case "match":
			data, _ := msg["data"].(map[string]interface{})
			path, _ := data["path"].(map[string]interface{})
			pathText, _ := path["text"].(string)

			lines, _ := data["lines"].(map[string]interface{})
			lineText, _ := lines["text"].(string)

			lineNum, _ := data["line_number"].(float64)

			submatches, _ := data["submatches"].([]interface{})
			col := 1
			if len(submatches) > 0 {
				sm, _ := submatches[0].(map[string]interface{})
				start, _ := sm["start"].(float64)
				col = int(start) + 1
			}

			match := SearchMatch{
				File:    pathText,
				Line:    int(lineNum),
				Column:  col,
				Content: strings.TrimRight(lineText, "\n"),
			}

			result.Matches = append(result.Matches, match)
			filesSearched[pathText] = true

		case "summary":
			data, _ := msg["data"].(map[string]interface{})
			stats, _ := data["stats"].(map[string]interface{})
			if matches, ok := stats["matches"].(float64); ok {
				result.TotalMatches = int(matches)
			}
		}
	}

	result.FilesSearched = len(filesSearched)
	if result.TotalMatches == 0 {
		result.TotalMatches = len(result.Matches)
	}

	return result, nil
}

// searchFallback provides a basic search when ripgrep is not available
func searchFallback(projectPath, query string, opts SearchOptions) (*SearchResult, error) {
	result := &SearchResult{
		Query:   query,
		Matches: []SearchMatch{},
	}

	// Use grep as fallback
	args := []string{"-r", "-n"}

	if !opts.CaseSensitive {
		args = append(args, "-i")
	}

	if opts.Pattern != "" {
		args = append(args, "--include", opts.Pattern)
	}

	args = append(args, query, ".")

	cmd := exec.Command("grep", args...)
	cmd.Dir = projectPath

	output, _ := cmd.Output()

	// Parse grep output (file:line:content)
	filesSearched := make(map[string]bool)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 {
			continue
		}

		file := strings.TrimPrefix(parts[0], "./")
		lineNum := 1
		fmt.Sscanf(parts[1], "%d", &lineNum)
		content := parts[2]

		match := SearchMatch{
			File:    file,
			Line:    lineNum,
			Column:  1,
			Content: content,
		}

		result.Matches = append(result.Matches, match)
		filesSearched[file] = true

		if opts.MaxResults > 0 && len(result.Matches) >= opts.MaxResults {
			break
		}
	}

	result.FilesSearched = len(filesSearched)
	result.TotalMatches = len(result.Matches)

	return result, nil
}

// TextOutput returns human-readable output for SearchResult
func (r *SearchResult) TextOutput() string {
	var output strings.Builder
	output.WriteString(fmt.Sprintf("Search: \"%s\"\n", r.Query))
	output.WriteString(fmt.Sprintf("Found %d matches in %d files\n\n", r.TotalMatches, r.FilesSearched))

	for _, match := range r.Matches {
		output.WriteString(fmt.Sprintf("%s:%d:%d: %s\n", match.File, match.Line, match.Column, match.Content))
	}

	return output.String()
}
