// internal/lsp/refactor_test.go
package lsp

import (
	"strings"
	"testing"
)

func TestReplaceWordInLine(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		oldWord string
		newWord string
		want    string
	}{
		{
			name:    "simple replacement",
			line:    "const foo = 123",
			oldWord: "foo",
			newWord: "bar",
			want:    "const bar = 123",
		},
		{
			name:    "no match",
			line:    "const foo = 123",
			oldWord: "baz",
			newWord: "qux",
			want:    "const foo = 123",
		},
		{
			name:    "multiple occurrences",
			line:    "foo + foo + foo",
			oldWord: "foo",
			newWord: "bar",
			want:    "bar + bar + bar",
		},
		{
			name:    "word boundary - prefix",
			line:    "const foobar = 123",
			oldWord: "foo",
			newWord: "bar",
			want:    "const foobar = 123",
		},
		{
			name:    "word boundary - suffix",
			line:    "const barfoo = 123",
			oldWord: "foo",
			newWord: "bar",
			want:    "const barfoo = 123",
		},
		{
			name:    "word with underscore",
			line:    "const my_var = 123",
			oldWord: "my_var",
			newWord: "new_var",
			want:    "const new_var = 123",
		},
		{
			name:    "word at start",
			line:    "foo = bar",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz = bar",
		},
		{
			name:    "word at end",
			line:    "const x = foo",
			oldWord: "foo",
			newWord: "bar",
			want:    "const x = bar",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replaceWordInLine(tt.line, tt.oldWord, tt.newWord)
			if got != tt.want {
				t.Errorf("replaceWordInLine() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestReplaceWord(t *testing.T) {
	tests := []struct {
		name    string
		content string
		oldWord string
		newWord string
		want    string
	}{
		{
			name:    "multiline replacement",
			content: "const foo = 1\nconst bar = foo\nfoo + foo",
			oldWord: "foo",
			newWord: "baz",
			want:    "const baz = 1\nconst bar = baz\nbaz + baz",
		},
		{
			name:    "empty content",
			content: "",
			oldWord: "foo",
			newWord: "bar",
			want:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replaceWord(tt.content, tt.oldWord, tt.newWord)
			if got != tt.want {
				t.Errorf("replaceWord() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDetectFormatter(t *testing.T) {
	// We can't test all cases without actual filesystem setup,
	// but we can test the default fallback
	formatter := detectFormatter("/nonexistent/path")
	if formatter != "prettier" {
		t.Errorf("detectFormatter() should default to prettier, got %v", formatter)
	}
}

func TestRenameResult_TextOutput(t *testing.T) {
	result := &RenameResult{
		OldName:       "oldName",
		NewName:       "newName",
		FilesAffected: 3,
		TotalChanges:  10,
		Applied:       false,
	}

	output := result.TextOutput()
	if output == "" {
		t.Error("TextOutput should not be empty")
	}
}

func TestFormatResult_TextOutput(t *testing.T) {
	result := &FormatResult{
		Formatted:        []string{"file1.ts"},
		AlreadyFormatted: []string{"file2.ts"},
	}

	output := result.TextOutput()
	if output == "" {
		t.Error("TextOutput should not be empty")
	}
}

func TestReplaceWordInLine_EdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		oldWord string
		newWord string
		want    string
	}{
		{
			name:    "empty line",
			line:    "",
			oldWord: "foo",
			newWord: "bar",
			want:    "",
		},
		{
			name:    "only the word",
			line:    "foo",
			oldWord: "foo",
			newWord: "bar",
			want:    "bar",
		},
		{
			name:    "word with parentheses",
			line:    "foo(bar)",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz(bar)",
		},
		{
			name:    "word in function call",
			line:    "console.log(foo)",
			oldWord: "foo",
			newWord: "bar",
			want:    "console.log(bar)",
		},
		{
			name:    "word in array access",
			line:    "arr[foo]",
			oldWord: "foo",
			newWord: "bar",
			want:    "arr[bar]",
		},
		{
			name:    "word with dollar sign",
			line:    "$foo + $bar",
			oldWord: "$foo",
			newWord: "$baz",
			want:    "$baz + $bar",
		},
		{
			name:    "word in string should replace",
			line:    `const x = "foo"`,
			oldWord: "foo",
			newWord: "bar",
			want:    `const x = "bar"`,
		},
		{
			name:    "adjacent words",
			line:    "foo+bar",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz+bar",
		},
		{
			name:    "word with numbers",
			line:    "const foo123 = 1",
			oldWord: "foo123",
			newWord: "bar456",
			want:    "const bar456 = 1",
		},
		{
			name:    "partial match should not replace",
			line:    "const foo123 = 1",
			oldWord: "foo",
			newWord: "bar",
			want:    "const foo123 = 1",
		},
		{
			name:    "word in comment",
			line:    "// foo is a variable",
			oldWord: "foo",
			newWord: "bar",
			want:    "// bar is a variable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replaceWordInLine(tt.line, tt.oldWord, tt.newWord)
			if got != tt.want {
				t.Errorf("replaceWordInLine() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestReplaceWord_EdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		content string
		oldWord string
		newWord string
		want    string
	}{
		{
			name:    "single line no newline",
			content: "const foo = 1",
			oldWord: "foo",
			newWord: "bar",
			want:    "const bar = 1",
		},
		{
			name:    "trailing newline",
			content: "const foo = 1\n",
			oldWord: "foo",
			newWord: "bar",
			want:    "const bar = 1\n",
		},
		{
			name:    "multiple blank lines",
			content: "foo\n\n\nfoo",
			oldWord: "foo",
			newWord: "bar",
			want:    "bar\n\n\nbar",
		},
		{
			name:    "windows line endings",
			content: "foo\r\nbar\r\nfoo",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz\r\nbar\r\nbaz",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replaceWord(tt.content, tt.oldWord, tt.newWord)
			if got != tt.want {
				t.Errorf("replaceWord() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRenameResult_TextOutput_Applied(t *testing.T) {
	result := &RenameResult{
		OldName:       "oldName",
		NewName:       "newName",
		FilesAffected: 2,
		TotalChanges:  5,
		Applied:       true,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "applied") {
		t.Error("TextOutput should indicate changes were applied")
	}
	if !strings.Contains(output, "oldName") {
		t.Error("TextOutput should contain old name")
	}
	if !strings.Contains(output, "newName") {
		t.Error("TextOutput should contain new name")
	}
}

func TestRenameResult_TextOutput_DryRun(t *testing.T) {
	result := &RenameResult{
		OldName:       "oldName",
		NewName:       "newName",
		FilesAffected: 2,
		TotalChanges:  5,
		Applied:       false,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "Dry run") {
		t.Error("TextOutput should indicate dry run")
	}
}

func TestRenameResult_TextOutput_WithChanges(t *testing.T) {
	result := &RenameResult{
		OldName:       "foo",
		NewName:       "bar",
		FilesAffected: 2,
		TotalChanges:  3,
		Changes: []RenameChange{
			{File: "src/a.ts", Line: 10, Old: "foo", New: "bar"},
			{File: "src/b.ts", Line: 20, Old: "foo", New: "bar"},
			{File: "src/b.ts", Line: 30, Old: "foo", New: "bar"},
		},
		Applied: false,
	}

	output := result.TextOutput()
	if !strings.Contains(output, "src/a.ts:10") {
		t.Error("TextOutput should contain file:line for changes")
	}
	if !strings.Contains(output, "src/b.ts:20") {
		t.Error("TextOutput should contain file:line for changes")
	}
}

func TestFormatResult_TextOutput_AllCategories(t *testing.T) {
	result := &FormatResult{
		Formatted:        []string{"a.ts", "b.ts"},
		AlreadyFormatted: []string{"c.ts"},
		Errors:           []string{"d.ts: formatting error"},
	}

	output := result.TextOutput()
	if !strings.Contains(output, "Formatted:") {
		t.Error("TextOutput should contain Formatted section")
	}
	if !strings.Contains(output, "Already formatted:") {
		t.Error("TextOutput should contain Already formatted section")
	}
	if !strings.Contains(output, "Errors:") {
		t.Error("TextOutput should contain Errors section")
	}
}

func TestFormatResult_TextOutput_OnlyErrors(t *testing.T) {
	result := &FormatResult{
		Errors: []string{"file.ts: parse error"},
	}

	output := result.TextOutput()
	if !strings.Contains(output, "Errors:") {
		t.Error("TextOutput should contain Errors section")
	}
	if strings.Contains(output, "Formatted:") {
		t.Error("TextOutput should not contain Formatted section when empty")
	}
}

func TestRenameChange_Fields(t *testing.T) {
	change := RenameChange{
		File: "src/app.tsx",
		Line: 42,
		Old:  "foo",
		New:  "bar",
	}

	if change.File != "src/app.tsx" {
		t.Errorf("File = %v, want src/app.tsx", change.File)
	}
	if change.Line != 42 {
		t.Errorf("Line = %v, want 42", change.Line)
	}
	if change.Old != "foo" {
		t.Errorf("Old = %v, want foo", change.Old)
	}
	if change.New != "bar" {
		t.Errorf("New = %v, want bar", change.New)
	}
}

func TestDetectFormatter_WithTempDir(t *testing.T) {
	// Test with a real temp directory
	tmpDir := t.TempDir()

	// Default should be prettier for empty directory
	formatter := detectFormatter(tmpDir)
	if formatter != "prettier" {
		t.Errorf("detectFormatter() should default to prettier, got %v", formatter)
	}
}

func TestReplaceWordInLine_SpecialCharacters(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		oldWord string
		newWord string
		want    string
	}{
		{
			name:    "equals sign boundary",
			line:    "foo=bar",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz=bar",
		},
		{
			name:    "semicolon boundary",
			line:    "foo;",
			oldWord: "foo",
			newWord: "bar",
			want:    "bar;",
		},
		{
			name:    "comma boundary",
			line:    "foo,bar,foo",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz,bar,baz",
		},
		{
			name:    "colon boundary",
			line:    "foo:bar",
			oldWord: "foo",
			newWord: "baz",
			want:    "baz:bar",
		},
		{
			name:    "dot boundary - method call",
			line:    "obj.foo()",
			oldWord: "foo",
			newWord: "bar",
			want:    "obj.bar()",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replaceWordInLine(tt.line, tt.oldWord, tt.newWord)
			if got != tt.want {
				t.Errorf("replaceWordInLine() = %v, want %v", got, tt.want)
			}
		})
	}
}
