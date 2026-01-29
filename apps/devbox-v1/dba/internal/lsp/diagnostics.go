// internal/lsp/diagnostics.go
package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Diagnostic represents a code diagnostic (error, warning, etc.)
type Diagnostic struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Column    int    `json:"column"`
	EndLine   int    `json:"end_line,omitempty"`
	EndColumn int    `json:"end_column,omitempty"`
	Severity  string `json:"severity"` // error, warning, info, hint
	Message   string `json:"message"`
	Code      string `json:"code,omitempty"`
	Source    string `json:"source"` // typescript, eslint, etc.
}

// DiagnosticsResult is the result of getting diagnostics
type DiagnosticsResult struct {
	Diagnostics []Diagnostic `json:"diagnostics"`
	Summary     struct {
		Errors   int `json:"errors"`
		Warnings int `json:"warnings"`
		Info     int `json:"info"`
		Hint     int `json:"hint"`
	} `json:"summary"`
}

// DiagnosticsOptions are options for filtering diagnostics
type DiagnosticsOptions struct {
	File     string
	Severity string
	Source   string
}

// TextOutput returns human-readable output for diagnostics
func (r *DiagnosticsResult) TextOutput() string {
	if len(r.Diagnostics) == 0 {
		return "No diagnostics found"
	}

	var output strings.Builder
	output.WriteString("Diagnostics:\n")

	for _, d := range r.Diagnostics {
		icon := "  "
		switch d.Severity {
		case "error":
			icon = "E "
		case "warning":
			icon = "W "
		case "info":
			icon = "I "
		case "hint":
			icon = "H "
		}
		output.WriteString("  " + icon + d.File + ":" + strconv.Itoa(d.Line) + ":" + strconv.Itoa(d.Column) + "\n")
		output.WriteString("    " + d.Message + "\n")
		if d.Code != "" {
			output.WriteString("    [" + d.Source + ": " + d.Code + "]\n")
		}
	}

	output.WriteString("\nSummary: ")
	output.WriteString(strconv.Itoa(r.Summary.Errors) + " errors, ")
	output.WriteString(strconv.Itoa(r.Summary.Warnings) + " warnings, ")
	output.WriteString(strconv.Itoa(r.Summary.Info) + " info, ")
	output.WriteString(strconv.Itoa(r.Summary.Hint) + " hints\n")

	return output.String()
}

// GetDiagnostics returns all diagnostics for the project
func GetDiagnostics(ctx context.Context, projectPath string, opts DiagnosticsOptions) (*DiagnosticsResult, error) {
	result := &DiagnosticsResult{
		Diagnostics: []Diagnostic{},
	}

	// Check for TypeScript
	if hasTypeScript(projectPath) {
		tsDiags, err := getTypeScriptDiagnostics(ctx, projectPath)
		if err == nil {
			result.Diagnostics = append(result.Diagnostics, tsDiags...)
		}
	}

	// Check for ESLint
	if hasESLint(projectPath) {
		eslintDiags, err := getESLintDiagnostics(ctx, projectPath)
		if err == nil {
			result.Diagnostics = append(result.Diagnostics, eslintDiags...)
		}
	}

	// Filter by options
	result.Diagnostics = filterDiagnostics(result.Diagnostics, opts)

	// Calculate summary
	for _, d := range result.Diagnostics {
		switch d.Severity {
		case "error":
			result.Summary.Errors++
		case "warning":
			result.Summary.Warnings++
		case "info":
			result.Summary.Info++
		case "hint":
			result.Summary.Hint++
		}
	}

	return result, nil
}

func getTypeScriptDiagnostics(ctx context.Context, projectPath string) ([]Diagnostic, error) {
	// Run tsc with pretty output disabled for parsing
	cmd := exec.CommandContext(ctx, "npx", "tsc", "--noEmit", "--pretty", "false")
	cmd.Dir = projectPath

	output, _ := cmd.CombinedOutput() // tsc exits non-zero on errors

	return parseTypeScriptOutput(string(output), projectPath)
}

func parseTypeScriptOutput(output, projectPath string) ([]Diagnostic, error) {
	var diagnostics []Diagnostic

	// TypeScript error format: file(line,col): error TS1234: message
	re := regexp.MustCompile(`^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$`)

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		matches := re.FindStringSubmatch(line)
		if matches == nil {
			continue
		}

		lineNum, _ := strconv.Atoi(matches[2])
		colNum, _ := strconv.Atoi(matches[3])
		severity := matches[4]
		code := matches[5]
		message := matches[6]

		// Make path relative
		file := matches[1]
		if rel, err := filepath.Rel(projectPath, file); err == nil {
			file = rel
		}

		diagnostics = append(diagnostics, Diagnostic{
			File:     file,
			Line:     lineNum,
			Column:   colNum,
			Severity: severity,
			Message:  message,
			Code:     code,
			Source:   "typescript",
		})
	}

	return diagnostics, nil
}

// ESLintResult represents the structure of ESLint JSON output
type ESLintResult struct {
	FilePath string `json:"filePath"`
	Messages []struct {
		Line     int    `json:"line"`
		Column   int    `json:"column"`
		EndLine  int    `json:"endLine"`
		EndCol   int    `json:"endColumn"`
		Severity int    `json:"severity"` // 1=warning, 2=error
		Message  string `json:"message"`
		RuleId   string `json:"ruleId"`
	} `json:"messages"`
}

func getESLintDiagnostics(ctx context.Context, projectPath string) ([]Diagnostic, error) {
	cmd := exec.CommandContext(ctx, "npx", "eslint", ".", "--format=json", "--ext", ".ts,.tsx,.js,.jsx")
	cmd.Dir = projectPath

	output, _ := cmd.Output() // ESLint exits non-zero on errors

	return parseESLintOutput(output, projectPath)
}

func parseESLintOutput(output []byte, projectPath string) ([]Diagnostic, error) {
	var eslintResults []ESLintResult

	if len(output) == 0 {
		return nil, nil
	}

	if err := json.Unmarshal(output, &eslintResults); err != nil {
		return nil, err
	}

	var diagnostics []Diagnostic

	for _, file := range eslintResults {
		// Make path relative
		filePath := file.FilePath
		if rel, err := filepath.Rel(projectPath, filePath); err == nil {
			filePath = rel
		}

		for _, msg := range file.Messages {
			severity := "warning"
			if msg.Severity == 2 {
				severity = "error"
			}

			diagnostics = append(diagnostics, Diagnostic{
				File:      filePath,
				Line:      msg.Line,
				Column:    msg.Column,
				EndLine:   msg.EndLine,
				EndColumn: msg.EndCol,
				Severity:  severity,
				Message:   msg.Message,
				Code:      msg.RuleId,
				Source:    "eslint",
			})
		}
	}

	return diagnostics, nil
}

func filterDiagnostics(diags []Diagnostic, opts DiagnosticsOptions) []Diagnostic {
	if opts.File == "" && opts.Severity == "" && opts.Source == "" {
		return diags
	}

	var filtered []Diagnostic

	for _, d := range diags {
		if opts.File != "" && d.File != opts.File {
			continue
		}
		if opts.Severity != "" && d.Severity != opts.Severity {
			continue
		}
		if opts.Source != "" && d.Source != opts.Source {
			continue
		}
		filtered = append(filtered, d)
	}

	return filtered
}

func hasTypeScript(projectPath string) bool {
	tsconfig := filepath.Join(projectPath, "tsconfig.json")
	_, err := os.Stat(tsconfig)
	return err == nil
}

func hasESLint(projectPath string) bool {
	configs := []string{
		".eslintrc",
		".eslintrc.js",
		".eslintrc.json",
		".eslintrc.yml",
		".eslintrc.yaml",
		"eslint.config.js",
		"eslint.config.mjs",
	}
	for _, cfg := range configs {
		if _, err := os.Stat(filepath.Join(projectPath, cfg)); err == nil {
			return true
		}
	}
	// Check package.json for eslintConfig
	pkgPath := filepath.Join(projectPath, "package.json")
	if data, err := os.ReadFile(pkgPath); err == nil {
		var pkg map[string]interface{}
		if json.Unmarshal(data, &pkg) == nil {
			if _, ok := pkg["eslintConfig"]; ok {
				return true
			}
		}
	}
	return false
}
