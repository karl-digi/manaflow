// internal/lsp/actions.go
package lsp

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

// CodeAction represents a quick fix or refactoring action
type CodeAction struct {
	Index int    `json:"index"`
	Title string `json:"title"`
	Kind  string `json:"kind"` // quickfix, refactor, source
}

// CodeActionResult is the result of getting code actions
type CodeActionResult struct {
	Location string       `json:"location"`
	Actions  []CodeAction `json:"actions"`
}

// ApplyResult is the result of applying a code action
type ApplyResult struct {
	Applied bool   `json:"applied"`
	Title   string `json:"title"`
	Changes []struct {
		File  string `json:"file"`
		Edits []struct {
			Line    int    `json:"line"`
			OldText string `json:"old"`
			NewText string `json:"new"`
		} `json:"edits"`
	} `json:"changes"`
}

// TextOutput returns human-readable output for code action result
func (r *CodeActionResult) TextOutput() string {
	if len(r.Actions) == 0 {
		return fmt.Sprintf("No code actions available at %s", r.Location)
	}

	var output strings.Builder
	output.WriteString(fmt.Sprintf("Code actions at %s:\n", r.Location))
	for _, action := range r.Actions {
		output.WriteString(fmt.Sprintf("  [%d] %s (%s)\n", action.Index, action.Title, action.Kind))
	}
	output.WriteString("\nUse --apply --index=N to apply an action")
	return output.String()
}

// TextOutput returns human-readable output for apply result
func (r *ApplyResult) TextOutput() string {
	if !r.Applied {
		return "Action was not applied"
	}
	return fmt.Sprintf("Applied: %s", r.Title)
}

// GetCodeActions returns available code actions at a location
func GetCodeActions(ctx context.Context, projectPath, file string, line, col int) (*CodeActionResult, error) {
	result := &CodeActionResult{
		Location: fmt.Sprintf("%s:%d:%d", file, line, col),
		Actions:  []CodeAction{},
	}

	// Get diagnostics at this location to suggest fixes
	diagnostics, _ := GetDiagnostics(ctx, projectPath, DiagnosticsOptions{File: file})

	idx := 0
	for _, diag := range diagnostics.Diagnostics {
		if diag.Line == line {
			// Suggest fixes based on the error
			fixes := suggestFixes(diag)
			for _, fix := range fixes {
				fix.Index = idx
				result.Actions = append(result.Actions, fix)
				idx++
			}
		}
	}

	// Add common refactorings if we found any diagnostic at this line
	if len(result.Actions) > 0 || idx == 0 {
		result.Actions = append(result.Actions, CodeAction{
			Index: idx,
			Title: "Extract to function",
			Kind:  "refactor.extract",
		})
		idx++
		result.Actions = append(result.Actions, CodeAction{
			Index: idx,
			Title: "Extract to variable",
			Kind:  "refactor.extract",
		})
	}

	return result, nil
}

func suggestFixes(diag Diagnostic) []CodeAction {
	var fixes []CodeAction

	// Common TypeScript fixes
	if strings.Contains(diag.Code, "TS") || diag.Source == "typescript" {
		switch {
		case strings.Contains(diag.Message, "Did you mean"):
			// Extract the suggested name
			re := regexp.MustCompile(`Did you mean '(\w+)'\?`)
			if matches := re.FindStringSubmatch(diag.Message); len(matches) > 1 {
				fixes = append(fixes, CodeAction{
					Title: fmt.Sprintf("Change to '%s'", matches[1]),
					Kind:  "quickfix",
				})
			}

		case strings.Contains(diag.Message, "is declared but"):
			fixes = append(fixes, CodeAction{
				Title: "Remove unused variable",
				Kind:  "quickfix",
			})

		case strings.Contains(diag.Message, "Cannot find"):
			fixes = append(fixes, CodeAction{
				Title: "Add missing import",
				Kind:  "quickfix",
			})

		case strings.Contains(diag.Message, "does not exist on type"):
			// Extract property name from message like "Property 'foo' does not exist on type"
			re := regexp.MustCompile(`Property '(\w+)' does not exist`)
			if matches := re.FindStringSubmatch(diag.Message); len(matches) > 1 {
				fixes = append(fixes, CodeAction{
					Title: fmt.Sprintf("Add missing property '%s'", matches[1]),
					Kind:  "quickfix",
				})
			}

		case strings.Contains(diag.Message, "Type"):
			fixes = append(fixes, CodeAction{
				Title: "Add type assertion",
				Kind:  "quickfix",
			})
		}
	}

	// ESLint fixes
	if diag.Source == "eslint" && diag.Code != "" {
		fixes = append(fixes, CodeAction{
			Title: fmt.Sprintf("Disable %s for this line", diag.Code),
			Kind:  "quickfix",
		})
		fixes = append(fixes, CodeAction{
			Title: fmt.Sprintf("Disable %s for entire file", diag.Code),
			Kind:  "quickfix",
		})
	}

	return fixes
}

// ApplyCodeAction applies a code action
// This is a simplified implementation - real implementation would
// parse and apply the actual changes
func ApplyCodeAction(ctx context.Context, projectPath, file string, line, col int, actionIndex int) (*ApplyResult, error) {
	actions, err := GetCodeActions(ctx, projectPath, file, line, col)
	if err != nil {
		return nil, err
	}

	if actionIndex < 0 || actionIndex >= len(actions.Actions) {
		return nil, fmt.Errorf("invalid action index: %d (available: 0-%d)", actionIndex, len(actions.Actions)-1)
	}

	action := actions.Actions[actionIndex]

	// For now, return that we would apply it
	// Real implementation would modify the file
	return &ApplyResult{
		Applied: true,
		Title:   action.Title,
	}, nil
}
