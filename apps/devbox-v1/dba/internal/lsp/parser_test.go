// internal/lsp/parser_test.go
package lsp

import (
	"testing"
)

func TestParseLocation(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantFile string
		wantLine int
		wantCol  int
		wantErr  bool
	}{
		{
			name:     "file and line",
			input:    "src/app.tsx:42",
			wantFile: "src/app.tsx",
			wantLine: 42,
			wantCol:  1,
			wantErr:  false,
		},
		{
			name:     "file, line, and column",
			input:    "src/app.tsx:42:10",
			wantFile: "src/app.tsx",
			wantLine: 42,
			wantCol:  10,
			wantErr:  false,
		},
		{
			name:     "windows path with drive",
			input:    "C:/Users/test/file.ts:10:5",
			wantFile: "C",
			wantLine: 0,
			wantCol:  1,
			wantErr:  true, // Windows paths would need special handling
		},
		{
			name:    "invalid format - no line",
			input:   "src/app.tsx",
			wantErr: true,
		},
		{
			name:    "invalid line number",
			input:   "src/app.tsx:abc",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			file, line, col, err := ParseLocation(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseLocation() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr {
				if file != tt.wantFile {
					t.Errorf("ParseLocation() file = %v, want %v", file, tt.wantFile)
				}
				if line != tt.wantLine {
					t.Errorf("ParseLocation() line = %v, want %v", line, tt.wantLine)
				}
				if col != tt.wantCol {
					t.Errorf("ParseLocation() col = %v, want %v", col, tt.wantCol)
				}
			}
		})
	}
}

func TestFormatLocation(t *testing.T) {
	tests := []struct {
		name string
		file string
		line int
		col  int
		want string
	}{
		{
			name: "with column",
			file: "src/app.tsx",
			line: 42,
			col:  10,
			want: "src/app.tsx:42:10",
		},
		{
			name: "without column",
			file: "src/app.tsx",
			line: 42,
			col:  0,
			want: "src/app.tsx:42",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatLocation(tt.file, tt.line, tt.col)
			if got != tt.want {
				t.Errorf("FormatLocation() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGenerateVSCodeURL(t *testing.T) {
	tests := []struct {
		name        string
		codePort    int
		projectPath string
		file        string
		line        int
		wantURL     string
		wantHasFile bool
	}{
		{
			name:        "base URL only",
			codePort:    10080,
			projectPath: "/workspace/project",
			file:        "",
			line:        0,
			wantURL:     "http://localhost:10080/?folder=%2Fworkspace%2Fproject",
			wantHasFile: false,
		},
		{
			name:        "with file",
			codePort:    10080,
			projectPath: "/workspace/project",
			file:        "src/app.tsx",
			line:        0,
			wantHasFile: true,
		},
		{
			name:        "with file and line",
			codePort:    10080,
			projectPath: "/workspace/project",
			file:        "src/app.tsx",
			line:        42,
			wantHasFile: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GenerateVSCodeURL(tt.codePort, tt.projectPath, tt.file, tt.line)
			if result.URL == "" {
				t.Error("GenerateVSCodeURL() URL is empty")
			}
			if tt.wantHasFile && result.FileURL == "" {
				t.Error("GenerateVSCodeURL() FileURL should not be empty")
			}
			if !tt.wantHasFile && result.FileURL != "" {
				t.Error("GenerateVSCodeURL() FileURL should be empty")
			}
		})
	}
}

func TestValidSeverity(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"error", true},
		{"warning", true},
		{"info", true},
		{"hint", true},
		{"", true},
		{"invalid", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ValidSeverity(tt.input)
			if got != tt.want {
				t.Errorf("ValidSeverity(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidSource(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"typescript", true},
		{"eslint", true},
		{"", true},
		{"invalid", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ValidSource(tt.input)
			if got != tt.want {
				t.Errorf("ValidSource(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
