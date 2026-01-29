// internal/fs/read.go
package fs

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LargeFileThreshold is the size (10MB) above which warnings are issued
const LargeFileThreshold = 10 * 1024 * 1024

// ReadResult is the result of reading a file
type ReadResult struct {
	Path       string    `json:"path"`
	Content    string    `json:"content"`
	Size       int64     `json:"size"`
	ModifiedAt string    `json:"modified_at"`
	Encoding   string    `json:"encoding,omitempty"`
	Lines      *LineInfo `json:"lines,omitempty"`
	Warning    string    `json:"warning,omitempty"`
	IsSymlink  bool      `json:"is_symlink,omitempty"`
	SymlinkTarget string `json:"symlink_target,omitempty"`
}

// LineInfo contains information about the line range extracted
type LineInfo struct {
	Start int `json:"start"`
	End   int `json:"end"`
	Total int `json:"total"`
}

// ReadOptions are options for reading a file
type ReadOptions struct {
	Base64        bool   // Output as base64
	LineRange     string // Line range (e.g., "10:20" or "50:")
	FollowSymlinks bool  // Follow symlinks (default: true)
}

// Read reads a file and returns its contents
func Read(projectPath, filePath string, opts ReadOptions) (*ReadResult, error) {
	fullPath := filepath.Join(projectPath, filePath)

	// Check for symlinks first using Lstat
	linfo, err := os.Lstat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", filePath)
		}
		return nil, err
	}

	var isSymlink bool
	var symlinkTarget string
	if linfo.Mode()&os.ModeSymlink != 0 {
		isSymlink = true
		target, err := os.Readlink(fullPath)
		if err == nil {
			symlinkTarget = target
		}
		// If not following symlinks, return info about the symlink itself
		if !opts.FollowSymlinks {
			return &ReadResult{
				Path:          filePath,
				Size:          linfo.Size(),
				ModifiedAt:    linfo.ModTime().Format(time.RFC3339),
				IsSymlink:     true,
				SymlinkTarget: symlinkTarget,
				Content:       symlinkTarget,
				Encoding:      "symlink",
			}, nil
		}
	}

	// Get file info (follows symlinks)
	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", filePath)
		}
		return nil, err
	}

	if info.IsDir() {
		return nil, fmt.Errorf("path is a directory: %s", filePath)
	}

	// Read file
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, err
	}

	result := &ReadResult{
		Path:          filePath,
		Size:          info.Size(),
		ModifiedAt:    info.ModTime().Format(time.RFC3339),
		IsSymlink:     isSymlink,
		SymlinkTarget: symlinkTarget,
	}

	// Warn about large files
	if info.Size() > LargeFileThreshold {
		result.Warning = fmt.Sprintf("Large file (%d MB). Consider using --lines to read a portion.",
			info.Size()/(1024*1024))
	}

	// Handle line range
	if opts.LineRange != "" {
		content, lineInfo, err := extractLineRange(string(data), opts.LineRange)
		if err != nil {
			return nil, err
		}
		result.Content = content
		result.Lines = lineInfo
		result.Encoding = "utf-8"
	} else if opts.Base64 {
		result.Content = base64.StdEncoding.EncodeToString(data)
		result.Encoding = "base64"
	} else {
		result.Content = string(data)
		result.Encoding = "utf-8"
	}

	return result, nil
}

func extractLineRange(content, rangeStr string) (string, *LineInfo, error) {
	lines := strings.Split(content, "\n")
	totalLines := len(lines)

	// Parse range (e.g., "10:20", "10:", ":20")
	parts := strings.Split(rangeStr, ":")
	if len(parts) != 2 {
		return "", nil, fmt.Errorf("invalid line range format: %s (use START:END)", rangeStr)
	}

	start := 1
	end := totalLines

	if parts[0] != "" {
		_, err := fmt.Sscanf(parts[0], "%d", &start)
		if err != nil {
			return "", nil, fmt.Errorf("invalid start line: %s", parts[0])
		}
	}
	if parts[1] != "" {
		_, err := fmt.Sscanf(parts[1], "%d", &end)
		if err != nil {
			return "", nil, fmt.Errorf("invalid end line: %s", parts[1])
		}
	}

	// Convert to 0-indexed
	start--
	if start < 0 {
		start = 0
	}
	if end > totalLines {
		end = totalLines
	}

	if start >= end {
		return "", nil, fmt.Errorf("invalid line range: start must be less than end")
	}

	selectedLines := lines[start:end]

	return strings.Join(selectedLines, "\n"), &LineInfo{
		Start: start + 1, // Back to 1-indexed for output
		End:   end,
		Total: totalLines,
	}, nil
}

// TextOutput returns human-readable output for ReadResult
func (r *ReadResult) TextOutput() string {
	output := fmt.Sprintf("File: %s (%d bytes)\n", r.Path, r.Size)
	output += fmt.Sprintf("Modified: %s\n", r.ModifiedAt)
	if r.Lines != nil {
		output += fmt.Sprintf("Lines: %d-%d of %d\n", r.Lines.Start, r.Lines.End, r.Lines.Total)
	}
	output += "\n"
	output += r.Content
	return output
}
