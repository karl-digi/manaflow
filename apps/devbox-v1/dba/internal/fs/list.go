// internal/fs/list.go
package fs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Entry represents a file or directory
type Entry struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // "file" or "directory"
	Size     int64  `json:"size,omitempty"`
	Modified string `json:"modified,omitempty"`
	Children int    `json:"children,omitempty"` // For directories
}

// ListResult is the result of listing a directory
type ListResult struct {
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}

// ListOptions are options for listing files
type ListOptions struct {
	Recursive bool
	Hidden    bool
	GitIgnore bool
	Pattern   string
	MaxDepth  int
}

// List lists files in a directory
func List(projectPath, dirPath string, opts ListOptions) (*ListResult, error) {
	fullPath := projectPath
	if dirPath != "" && dirPath != "." {
		fullPath = filepath.Join(projectPath, dirPath)
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("directory not found: %s", dirPath)
		}
		return nil, err
	}

	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", dirPath)
	}

	entries, err := listDir(fullPath, projectPath, opts, 0)
	if err != nil {
		return nil, err
	}

	displayPath := dirPath
	if displayPath == "" {
		displayPath = "."
	}

	return &ListResult{
		Path:    displayPath,
		Entries: entries,
	}, nil
}

func listDir(dirPath, projectRoot string, opts ListOptions, depth int) ([]Entry, error) {
	if opts.MaxDepth > 0 && depth >= opts.MaxDepth {
		return nil, nil
	}

	dirEntries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}

	var entries []Entry

	for _, de := range dirEntries {
		name := de.Name()

		// Skip hidden files unless requested
		if !opts.Hidden && strings.HasPrefix(name, ".") {
			continue
		}

		// Skip common ignored directories
		if de.IsDir() && shouldIgnore(name, opts.GitIgnore) {
			continue
		}

		// Pattern matching
		if opts.Pattern != "" {
			matched, _ := filepath.Match(opts.Pattern, name)
			if !matched && !de.IsDir() {
				continue
			}
		}

		info, err := de.Info()
		if err != nil {
			continue
		}

		entry := Entry{
			Name: name,
		}

		if de.IsDir() {
			entry.Type = "directory"

			// Count children
			subPath := filepath.Join(dirPath, name)
			subEntries, _ := os.ReadDir(subPath)
			entry.Children = len(subEntries)

			// Recurse if requested
			if opts.Recursive {
				children, err := listDir(subPath, projectRoot, opts, depth+1)
				if err == nil && len(children) > 0 {
					// For recursive, flatten into parent list with relative paths
					for _, child := range children {
						child.Name = filepath.Join(name, child.Name)
						entries = append(entries, child)
					}
				}
			}
		} else {
			entry.Type = "file"
			entry.Size = info.Size()
			entry.Modified = info.ModTime().Format(time.RFC3339)
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

func shouldIgnore(name string, gitignore bool) bool {
	// Always ignore these
	ignore := map[string]bool{
		"node_modules": true,
		".git":         true,
		"__pycache__":  true,
		".next":        true,
		"dist":         true,
		"build":        true,
		".dba":         true,
		".venv":        true,
		"venv":         true,
		".cache":       true,
		"target":       true, // Rust
		"vendor":       true, // Go modules when vendored
	}

	return ignore[name]
}

// TextOutput returns human-readable output for ListResult
func (r *ListResult) TextOutput() string {
	var output strings.Builder
	output.WriteString(fmt.Sprintf("Directory: %s\n", r.Path))
	output.WriteString(fmt.Sprintf("Entries: %d\n\n", len(r.Entries)))

	for _, entry := range r.Entries {
		if entry.Type == "directory" {
			output.WriteString(fmt.Sprintf("📁 %s/ (%d items)\n", entry.Name, entry.Children))
		} else {
			output.WriteString(fmt.Sprintf("📄 %s (%d bytes)\n", entry.Name, entry.Size))
		}
	}

	return output.String()
}
