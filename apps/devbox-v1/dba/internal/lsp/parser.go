// internal/lsp/parser.go
package lsp

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ParseLocation parses a location string in the format file:line[:col]
func ParseLocation(loc string) (file string, line, col int, err error) {
	parts := strings.Split(loc, ":")
	if len(parts) < 2 {
		return "", 0, 0, fmt.Errorf("invalid location format: %s (expected file:line[:col])", loc)
	}

	file = parts[0]
	line, err = strconv.Atoi(parts[1])
	if err != nil {
		return "", 0, 0, fmt.Errorf("invalid line number: %s", parts[1])
	}

	col = 1
	if len(parts) >= 3 {
		col, err = strconv.Atoi(parts[2])
		if err != nil {
			return "", 0, 0, fmt.Errorf("invalid column number: %s", parts[2])
		}
	}

	return file, line, col, nil
}

// FormatLocation formats a location as a string
func FormatLocation(file string, line, col int) string {
	if col > 0 {
		return fmt.Sprintf("%s:%d:%d", file, line, col)
	}
	return fmt.Sprintf("%s:%d", file, line)
}

// URLResult is the result of generating a VS Code URL
type URLResult struct {
	URL     string `json:"url"`
	FileURL string `json:"file_url,omitempty"`
}

// TextOutput returns human-readable output for URL result
func (r *URLResult) TextOutput() string {
	var output strings.Builder
	output.WriteString(fmt.Sprintf("VS Code URL: %s\n", r.URL))
	if r.FileURL != "" {
		output.WriteString(fmt.Sprintf("File URL: %s\n", r.FileURL))
	}
	return output.String()
}

// GenerateVSCodeURL generates a VS Code URL for the workspace
func GenerateVSCodeURL(codePort int, projectPath string, file string, line int) *URLResult {
	baseURL := fmt.Sprintf("http://localhost:%d/?folder=%s",
		codePort, url.QueryEscape(projectPath))

	result := &URLResult{
		URL: baseURL,
	}

	if file != "" {
		fileURL := fmt.Sprintf("%s&file=%s", baseURL, url.QueryEscape(file))
		if line > 0 {
			fileURL = fmt.Sprintf("%s&line=%d", fileURL, line)
		}
		result.FileURL = fileURL
	}

	return result
}

// Severity levels for filtering
const (
	SeverityError   = "error"
	SeverityWarning = "warning"
	SeverityInfo    = "info"
	SeverityHint    = "hint"
)

// ValidSeverity checks if a severity value is valid
func ValidSeverity(severity string) bool {
	switch severity {
	case SeverityError, SeverityWarning, SeverityInfo, SeverityHint, "":
		return true
	default:
		return false
	}
}

// Source types for filtering
const (
	SourceTypeScript = "typescript"
	SourceESLint     = "eslint"
)

// ValidSource checks if a source value is valid
func ValidSource(source string) bool {
	switch source {
	case SourceTypeScript, SourceESLint, "":
		return true
	default:
		return false
	}
}
