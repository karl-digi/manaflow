// internal/fs/write.go
package fs

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

// WriteResult is the result of writing a file
type WriteResult struct {
	Path          string `json:"path"`
	BytesWritten  int    `json:"bytes_written"`
	Created       bool   `json:"created"`
	SyncTriggered bool   `json:"sync_triggered"`
}

// WriteOptions are options for writing a file
type WriteOptions struct {
	Content string      // Content to write
	Base64  bool        // Content is base64 encoded
	Append  bool        // Append instead of overwrite
	Mode    os.FileMode // File permissions
	MkdirP  bool        // Create parent directories
}

// Write writes content to a file
func Write(projectPath, filePath string, opts WriteOptions) (*WriteResult, error) {
	fullPath := filepath.Join(projectPath, filePath)

	// Check if file exists
	_, err := os.Stat(fullPath)
	created := os.IsNotExist(err)

	// Create parent directories if needed
	if opts.MkdirP {
		dir := filepath.Dir(fullPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create parent directories: %w", err)
		}
	}

	// Decode content if base64
	var data []byte
	if opts.Base64 {
		var decodeErr error
		data, decodeErr = base64.StdEncoding.DecodeString(opts.Content)
		if decodeErr != nil {
			return nil, fmt.Errorf("invalid base64 content: %w", decodeErr)
		}
	} else {
		data = []byte(opts.Content)
	}

	// Set default mode
	mode := opts.Mode
	if mode == 0 {
		mode = 0644
	}

	// Write file
	var flags int
	if opts.Append {
		flags = os.O_APPEND | os.O_CREATE | os.O_WRONLY
	} else {
		flags = os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	}

	f, err := os.OpenFile(fullPath, flags, mode)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	n, err := f.Write(data)
	if err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return &WriteResult{
		Path:          filePath,
		BytesWritten:  n,
		Created:       created,
		SyncTriggered: true, // File watcher will detect this
	}, nil
}

// TextOutput returns human-readable output for WriteResult
func (r *WriteResult) TextOutput() string {
	action := "Updated"
	if r.Created {
		action = "Created"
	}
	return fmt.Sprintf("%s %s (%d bytes written)", action, r.Path, r.BytesWritten)
}
